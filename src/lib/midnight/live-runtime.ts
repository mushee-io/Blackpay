import { deployContract, findDeployedContract, submitCallTx } from "@midnight-ntwrk/midnight-js-contracts";
import type { ContractAddress } from "@midnight-ntwrk/midnight-js-protocol/compact-runtime";
import { bytesToHex, hexToBytes32 } from "./bytes";
import {
  clearPayrollContractGateway,
  registerPayrollContractGateway,
  type PayrollContractGateway,
  type PrivateEmployeeWitness,
} from "./contract-client";
import {
  decryptEmployeeAccessPayload,
  encryptEmployeeAccessPayload,
  type EmployeeAccessEnvelope,
} from "./employee-access";
import {
  createCompiledBlackpayContract,
  type GeneratedBlackpayModule,
  type BlackpayLedgerView,
} from "./generated-contract";
import {
  BLACKPAY_PRIVATE_STATE_ID,
  activateEmployeeWitness,
  createInitialBlackpayPrivateState,
  employeeWitnessFromRecord,
  listPortalPayslips,
  setPrivateWorkspaceCurrency,
  type BlackpayPortalPayslipRecord,
  type BlackpayPrivateState,
  updatePortalPayRunStatus,
  upsertEmployeeWitness,
  upsertPayRunWitness,
  upsertPortalPayslip,
} from "./private-state";
import { buildBlackpayProviders, type BlackpayProviders, type BlackpayCircuitId } from "./providers";
import type { ConnectedWallet } from "./wallet";
import { payoutCommitment } from "../payroll/commitments";
import type { PayrollFrequency, PrivatePayrollPayment } from "../payroll/types";

export type BlackpayRuntimeRole = "admin" | "employee";
export type BlackpayRuntimeStatus = {
  ready: boolean;
  contractAddress?: string;
  role?: BlackpayRuntimeRole;
  networkId?: string;
};

export type EmployeePortalSnapshot = {
  employeeIdHex: string;
  salaryMinor: bigint;
  status: "active" | "inactive";
  payslips: BlackpayPortalPayslipRecord[];
};

type LiveRuntime = {
  wallet: ConnectedWallet;
  providers: BlackpayProviders;
  compiledContract: any;
  generated: GeneratedBlackpayModule;
  contractAddress: ContractAddress;
  role: BlackpayRuntimeRole;
};

type FinalizedCall = {
  public: { txId: string };
  private: { result: unknown };
};

let runtime: LiveRuntime | undefined;

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

function frequencyValue(generated: GeneratedBlackpayModule, frequency: PayrollFrequency): number {
  if (frequency === "weekly") return generated.PayrollFrequency.Weekly;
  if (frequency === "biweekly") return generated.PayrollFrequency.Biweekly;
  return generated.PayrollFrequency.Monthly;
}

async function queryLedger(current: LiveRuntime): Promise<BlackpayLedgerView | null> {
  const state = await current.providers.publicDataProvider.queryContractState(current.contractAddress);
  return state ? current.generated.ledger(state.data) : null;
}

async function confirmLedger(
  current: LiveRuntime,
  description: string,
  predicate: (ledger: BlackpayLedgerView) => boolean,
): Promise<BlackpayLedgerView> {
  let latest: BlackpayLedgerView | null = null;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    latest = await queryLedger(current);
    if (latest && predicate(latest)) return latest;
    await new Promise((resolve) => window.setTimeout(resolve, 500));
  }
  if (!latest) throw new Error(`Midnight indexer did not return Blackpay state after ${description}`);
  throw new Error(`Blackpay state did not confirm ${description} after transaction finalization`);
}

function requireRuntime(): LiveRuntime {
  if (!runtime) throw new Error("Blackpay Preview runtime is not initialized");
  return runtime;
}

function requireAdmin(current: LiveRuntime): void {
  if (current.role !== "admin") {
    throw new Error("This browser does not hold Blackpay payroll-admin private authority for the connected contract");
  }
}

async function getPrivateState(current: LiveRuntime): Promise<BlackpayPrivateState> {
  current.providers.privateStateProvider.setContractAddress(current.contractAddress);
  const state = await current.providers.privateStateProvider.get(BLACKPAY_PRIVATE_STATE_ID);
  if (!state) throw new Error("Blackpay encrypted private state is missing. Restore an encrypted backup before continuing.");
  return state;
}

async function setPrivateState(current: LiveRuntime, state: BlackpayPrivateState): Promise<void> {
  current.providers.privateStateProvider.setContractAddress(current.contractAddress);
  await current.providers.privateStateProvider.set(BLACKPAY_PRIVATE_STATE_ID, state);
}

async function submitCircuit(current: LiveRuntime, circuitId: BlackpayCircuitId, args: unknown[]): Promise<FinalizedCall> {
  const result = await submitCallTx(current.providers as any, {
    compiledContract: current.compiledContract,
    contractAddress: current.contractAddress,
    circuitId,
    args,
    privateStateId: BLACKPAY_PRIVATE_STATE_ID,
  } as any);
  if (!result.public.txId) throw new Error(`Midnight returned no transaction ID for ${circuitId}`);
  return result as unknown as FinalizedCall;
}

function gatewayFor(current: LiveRuntime): PayrollContractGateway {
  return {
    async createWorkspace(input) {
      requireAdmin(current);
      const workspaceId = hexToBytes32(input.workspaceIdHex, "workspace id");
      const currencyId = hexToBytes32(input.currencyIdHex, "currency id");
      const result = await submitCircuit(current, "createWorkspace", [
        workspaceId,
        currencyId,
        frequencyValue(current.generated, input.frequency),
      ]);
      await confirmLedger(current, "workspace creation", (ledger) =>
        ledger.workspaceCreated && equalBytes(ledger.workspaceId, workspaceId) && equalBytes(ledger.currencyId, currencyId),
      );
      return { transactionId: result.public.txId };
    },

    async addEmployee(input) {
      requireAdmin(current);
      const employeeId = hexToBytes32(input.employeeIdHex, "employee id");
      const state = upsertEmployeeWitness(await getPrivateState(current), input.employeeIdHex, input.witness);
      await setPrivateState(current, state);
      const expected = current.generated.pureCircuits.employeeCommitment(
        employeeId,
        input.witness.salaryMinor,
        hexToBytes32(input.witness.payoutCommitmentHex, "payout commitment"),
        hexToBytes32(input.witness.saltHex, "employee salt"),
      );
      const result = await submitCircuit(current, "addEmployee", [employeeId]);
      await confirmLedger(current, "employee commitment", (ledger) =>
        ledger.employees.member(employeeId) && equalBytes(ledger.employees.lookup(employeeId).commitment, expected),
      );
      return { transactionId: result.public.txId };
    },

    async updateEmployee(input) {
      requireAdmin(current);
      const employeeId = hexToBytes32(input.employeeIdHex, "employee id");
      const state = upsertEmployeeWitness(await getPrivateState(current), input.employeeIdHex, input.witness);
      await setPrivateState(current, state);
      const expected = current.generated.pureCircuits.employeeCommitment(
        employeeId,
        input.witness.salaryMinor,
        hexToBytes32(input.witness.payoutCommitmentHex, "payout commitment"),
        hexToBytes32(input.witness.saltHex, "employee salt"),
      );
      const result = await submitCircuit(current, "updateEmployee", [employeeId]);
      await confirmLedger(current, "employee update", (ledger) =>
        ledger.employees.member(employeeId) && equalBytes(ledger.employees.lookup(employeeId).commitment, expected),
      );
      return { transactionId: result.public.txId };
    },

    async removeEmployee(employeeIdHex) {
      requireAdmin(current);
      const employeeId = hexToBytes32(employeeIdHex, "employee id");
      const result = await submitCircuit(current, "removeEmployee", [employeeId]);
      await confirmLedger(current, "employee removal", (ledger) =>
        ledger.employees.member(employeeId) && ledger.employees.lookup(employeeId).status === current.generated.EmployeeStatus.Inactive,
      );
      return { transactionId: result.public.txId };
    },

    async createPayRun(input) {
      requireAdmin(current);
      if (!Number.isSafeInteger(input.period) || input.period <= 0) throw new Error("Pay period must be a positive safe integer");
      if (!Number.isSafeInteger(input.employeeCount) || input.employeeCount <= 0) throw new Error("Employee count must be a positive safe integer");
      const payRunId = hexToBytes32(input.payRunIdHex, "pay-run id");
      await setPrivateState(current, upsertPayRunWitness(await getPrivateState(current), input.payRunIdHex, input.witness));
      const expected = current.generated.pureCircuits.payRunCommitment(
        payRunId,
        input.witness.totalPayrollMinor,
        hexToBytes32(input.witness.paymentsRootHex, "payments root"),
        hexToBytes32(input.witness.saltHex, "pay-run salt"),
      );
      const result = await submitCircuit(current, "createPayRun", [payRunId, BigInt(input.period), BigInt(input.employeeCount)]);
      await confirmLedger(current, "pay-run creation", (ledger) =>
        ledger.payRuns.member(payRunId) &&
        ledger.payRuns.lookup(payRunId).status === current.generated.PayRunStatus.Draft &&
        equalBytes(ledger.payRuns.lookup(payRunId).commitment, expected),
      );
      return { transactionId: result.public.txId };
    },

    async approvePayRun(payRunIdHex) {
      requireAdmin(current);
      const payRunId = hexToBytes32(payRunIdHex, "pay-run id");
      const result = await submitCircuit(current, "approvePayRun", [payRunId]);
      await confirmLedger(current, "pay-run approval", (ledger) =>
        ledger.payRuns.member(payRunId) && ledger.payRuns.lookup(payRunId).status === current.generated.PayRunStatus.Approved,
      );
      await setPrivateState(current, updatePortalPayRunStatus(await getPrivateState(current), payRunIdHex, "approved"));
      return { transactionId: result.public.txId };
    },

    async finalizePayRun(input) {
      requireAdmin(current);
      const payRunId = hexToBytes32(input.payRunIdHex, "pay-run id");
      const settlement = hexToBytes32(input.transactionCommitmentHex, "settlement commitment");
      const result = await submitCircuit(current, "finalizePayRun", [payRunId, settlement]);
      await confirmLedger(current, "pay-run finalization", (ledger) =>
        ledger.payRuns.member(payRunId) &&
        ledger.payRuns.lookup(payRunId).status === current.generated.PayRunStatus.Executed &&
        equalBytes(ledger.payRuns.lookup(payRunId).transactionCommitment, settlement),
      );
      await setPrivateState(current, updatePortalPayRunStatus(await getPrivateState(current), input.payRunIdHex, "paid"));
      return { transactionId: result.public.txId };
    },

    async proveIncomeAtLeast(input) {
      const employeeId = hexToBytes32(input.employeeIdHex, "employee id");
      await setPrivateState(current, upsertEmployeeWitness(await getPrivateState(current), input.employeeIdHex, input.witness));
      const result = await submitCircuit(current, "proveIncomeAtLeast", [
        employeeId,
        input.thresholdMinor,
        hexToBytes32(input.nonceHex, "proof nonce"),
      ]);
      if (!(result.private.result instanceof Uint8Array)) throw new Error("Income circuit returned an invalid proof identifier");
      const proofIdHex = bytesToHex(result.private.result);
      const proofId = hexToBytes32(proofIdHex, "proof id");
      await confirmLedger(current, "income proof", (ledger) => ledger.incomeProofs.member(proofId));
      return { transactionId: result.public.txId, proofIdHex };
    },

    async createIncomeDisclosure(input) {
      const employeeId = hexToBytes32(input.employeeIdHex, "employee id");
      await setPrivateState(current, upsertEmployeeWitness(await getPrivateState(current), input.employeeIdHex, input.witness));
      const result = await submitCircuit(current, "createIncomeDisclosure", [
        employeeId,
        input.thresholdMinor,
        hexToBytes32(input.verifierIdHex, "verifier id"),
        input.expiresAt,
        hexToBytes32(input.nonceHex, "disclosure nonce"),
      ]);
      if (!(result.private.result instanceof Uint8Array)) throw new Error("Income disclosure circuit returned an invalid identifier");
      const disclosureIdHex = bytesToHex(result.private.result);
      const disclosureId = hexToBytes32(disclosureIdHex, "disclosure id");
      await confirmLedger(current, "income disclosure", (ledger) => ledger.disclosures.member(disclosureId));
      return { transactionId: result.public.txId, disclosureIdHex };
    },

    async createEmploymentDisclosure(input) {
      const employeeId = hexToBytes32(input.employeeIdHex, "employee id");
      await setPrivateState(current, upsertEmployeeWitness(await getPrivateState(current), input.employeeIdHex, input.witness));
      const result = await submitCircuit(current, "createEmploymentDisclosure", [
        employeeId,
        hexToBytes32(input.verifierIdHex, "verifier id"),
        input.expiresAt,
        hexToBytes32(input.nonceHex, "disclosure nonce"),
      ]);
      if (!(result.private.result instanceof Uint8Array)) throw new Error("Employment disclosure circuit returned an invalid identifier");
      const disclosureIdHex = bytesToHex(result.private.result);
      const disclosureId = hexToBytes32(disclosureIdHex, "disclosure id");
      await confirmLedger(current, "employment disclosure", (ledger) => ledger.disclosures.member(disclosureId));
      return { transactionId: result.public.txId, disclosureIdHex };
    },

    async revokeDisclosure(input) {
      const employeeId = hexToBytes32(input.employeeIdHex, "employee id");
      const disclosureId = hexToBytes32(input.disclosureIdHex, "disclosure id");
      const state = input.witness
        ? upsertEmployeeWitness(await getPrivateState(current), input.employeeIdHex, input.witness)
        : activateEmployeeWitness(await getPrivateState(current), input.employeeIdHex);
      await setPrivateState(current, state);
      const result = await submitCircuit(current, "revokeDisclosure", [employeeId, disclosureId]);
      await confirmLedger(current, "disclosure revocation", (ledger) =>
        ledger.disclosures.member(disclosureId) && ledger.disclosures.lookup(disclosureId).revoked,
      );
      return { transactionId: result.public.txId };
    },
  };
}

async function determineRole(current: LiveRuntime): Promise<BlackpayRuntimeRole> {
  const ledger = await confirmLedger(current, "contract discovery", () => true);
  const privateState = await getPrivateState(current);
  const derivedAdmin = current.generated.pureCircuits.deriveAdminPublicKey(privateState.adminSecret);
  return equalBytes(derivedAdmin, ledger.admin) ? "admin" : "employee";
}

export async function initializeBlackpayPreview(params: {
  wallet: ConnectedWallet;
  privateStatePassword: string;
  mode: "deploy" | "join";
  contractAddress?: string;
}): Promise<{ contractAddress: string; role: BlackpayRuntimeRole; deploymentTransactionId?: string }> {
  clearBlackpayLiveRuntime();
  const providers = await buildBlackpayProviders(params.wallet, params.privateStatePassword);
  const { generated, compiledContract } = await createCompiledBlackpayContract();

  let contractAddress: ContractAddress;
  let deploymentTransactionId: string | undefined;

  if (params.mode === "deploy") {
    const deployed = await deployContract(providers as any, {
      compiledContract,
      privateStateId: BLACKPAY_PRIVATE_STATE_ID,
      initialPrivateState: createInitialBlackpayPrivateState(),
    } as any);
    contractAddress = deployed.deployTxData.public.contractAddress;
    deploymentTransactionId = deployed.deployTxData.public.txId;
  } else {
    if (!params.contractAddress?.trim()) throw new Error("A deployed Blackpay contract address is required to join");
    contractAddress = params.contractAddress.trim() as ContractAddress;
    providers.privateStateProvider.setContractAddress(contractAddress);
    const existing = await providers.privateStateProvider.get(BLACKPAY_PRIVATE_STATE_ID);
    await findDeployedContract(providers as any, {
      contractAddress,
      compiledContract,
      privateStateId: BLACKPAY_PRIVATE_STATE_ID,
      ...(existing ? {} : { initialPrivateState: createInitialBlackpayPrivateState() }),
    } as any);
  }

  providers.privateStateProvider.setContractAddress(contractAddress);
  const current: LiveRuntime = {
    wallet: params.wallet,
    providers,
    compiledContract,
    generated,
    contractAddress,
    role: "employee",
  };
  runtime = current;
  current.role = await determineRole(current);
  registerPayrollContractGateway(gatewayFor(current));

  return {
    contractAddress: String(contractAddress),
    role: current.role,
    deploymentTransactionId,
  };
}

export function clearBlackpayLiveRuntime(): void {
  runtime = undefined;
  clearPayrollContractGateway();
}

export function getBlackpayRuntimeStatus(): BlackpayRuntimeStatus {
  if (!runtime) return { ready: false };
  return {
    ready: true,
    contractAddress: String(runtime.contractAddress),
    role: runtime.role,
    networkId: runtime.wallet.networkId,
  };
}

export async function readBlackpayLedger(): Promise<BlackpayLedgerView> {
  return confirmLedger(requireRuntime(), "ledger read", () => true);
}

export async function rememberPrivateWorkspaceCurrency(currencyCode: string): Promise<void> {
  const current = requireRuntime();
  requireAdmin(current);
  await setPrivateState(current, setPrivateWorkspaceCurrency(await getPrivateState(current), currencyCode));
}

export async function recordPortalPayslipsForPayRun(params: {
  payRunIdHex: string;
  period: number;
  payments: PrivatePayrollPayment[];
  currencyCode?: string;
}): Promise<void> {
  const current = requireRuntime();
  requireAdmin(current);
  let state = await getPrivateState(current);
  const currencyCode = (params.currencyCode || state.workspaceCurrencyCode || "TOKEN").trim().toUpperCase();
  for (const payment of params.payments) {
    const employee = state.employeeRecords?.[payment.employeeId];
    if (!employee) throw new Error(`Encrypted employee witness is missing for ${payment.employeeId}`);
    const recipientCommitment = await payoutCommitment(payment.shieldedRecipient);
    if (recipientCommitment !== bytesToHex(employee.payoutCommitment)) {
      throw new Error("Pay-run recipient does not match the employee wallet bound during registration");
    }
    state = upsertPortalPayslip(state, {
      employeeIdHex: payment.employeeId,
      payRunIdHex: params.payRunIdHex,
      period: params.period,
      grossMinor: payment.salaryMinor,
      netMinor: payment.salaryMinor,
      currencyCode,
      status: "pending",
      createdAt: Date.now(),
    });
  }
  await setPrivateState(current, state);
}

export async function markPortalPayRunPaid(payRunIdHex: string, paymentTransactionId: string): Promise<void> {
  const current = requireRuntime();
  requireAdmin(current);
  if (!paymentTransactionId.trim()) throw new Error("Settlement transaction ID is required");
  await setPrivateState(
    current,
    updatePortalPayRunStatus(await getPrivateState(current), payRunIdHex, "paid", paymentTransactionId.trim()),
  );
}

export async function issuePortalPayslip(params: {
  employeeIdHex: string;
  payRunIdHex: string;
  period: number;
  grossMinor: bigint;
  netMinor: bigint;
  currencyCode: string;
  paymentTransactionId?: string;
}): Promise<BlackpayPortalPayslipRecord> {
  const current = requireRuntime();
  requireAdmin(current);
  const employeeId = hexToBytes32(params.employeeIdHex, "employee id");
  const payRunId = hexToBytes32(params.payRunIdHex, "pay-run id");
  const ledger = await confirmLedger(current, "private payslip issuance", (value) =>
    value.employees.member(employeeId) && value.payRuns.member(payRunId),
  );
  const payRun = ledger.payRuns.lookup(payRunId);
  const status: BlackpayPortalPayslipRecord["status"] =
    payRun.status === current.generated.PayRunStatus.Executed
      ? "paid"
      : payRun.status === current.generated.PayRunStatus.Approved
        ? "approved"
        : "pending";
  if (status === "paid" && !params.paymentTransactionId?.trim()) {
    throw new Error("A paid payslip requires the real settlement transaction ID");
  }
  const payslip: BlackpayPortalPayslipRecord = {
    employeeIdHex: params.employeeIdHex,
    payRunIdHex: params.payRunIdHex,
    period: params.period,
    grossMinor: params.grossMinor,
    netMinor: params.netMinor,
    currencyCode: params.currencyCode,
    status,
    ...(params.paymentTransactionId?.trim() ? { paymentTransactionId: params.paymentTransactionId.trim() } : {}),
    createdAt: Date.now(),
  };
  await setPrivateState(current, upsertPortalPayslip(await getPrivateState(current), payslip));
  return payslip;
}

export async function exportEmployeeAccessPackage(params: {
  employeeIdHex: string;
  accessPassword: string;
}): Promise<EmployeeAccessEnvelope> {
  const current = requireRuntime();
  requireAdmin(current);
  const state = await getPrivateState(current);
  const employee = state.employeeRecords?.[params.employeeIdHex];
  if (!employee) throw new Error("No encrypted employee record exists for this employee identifier");
  const employeeId = hexToBytes32(params.employeeIdHex, "employee id");
  const ledger = await confirmLedger(current, "employee access export", (value) => value.employees.member(employeeId));
  const publicEntry = ledger.employees.lookup(employeeId);
  const expected = current.generated.pureCircuits.employeeCommitment(
    employeeId,
    employee.salaryMinor,
    employee.payoutCommitment,
    employee.salt,
  );
  if (!equalBytes(publicEntry.commitment, expected)) {
    throw new Error("Encrypted employee record does not match the live Blackpay contract commitment");
  }

  return encryptEmployeeAccessPayload({
    networkId: current.wallet.networkId,
    contractAddress: String(current.contractAddress),
    password: params.accessPassword,
    payload: {
      version: "blackpay-employee-access-v1",
      employeeIdHex: params.employeeIdHex,
      salaryMinor: employee.salaryMinor.toString(),
      payoutCommitmentHex: bytesToHex(employee.payoutCommitment),
      saltHex: bytesToHex(employee.salt),
      payslips: listPortalPayslips(state, params.employeeIdHex).map((payslip) => ({
        payRunIdHex: payslip.payRunIdHex,
        period: payslip.period,
        grossMinor: payslip.grossMinor.toString(),
        netMinor: payslip.netMinor.toString(),
        currencyCode: payslip.currencyCode,
        status: payslip.status,
        ...(payslip.paymentTransactionId ? { paymentTransactionId: payslip.paymentTransactionId } : {}),
        createdAt: payslip.createdAt,
      })),
    },
  });
}

export async function importEmployeeAccessPackage(
  envelopeValue: unknown,
  accessPassword: string,
): Promise<EmployeePortalSnapshot> {
  const current = requireRuntime();
  const { envelope, payload } = await decryptEmployeeAccessPayload(envelopeValue, accessPassword);
  if (envelope.networkId !== current.wallet.networkId) throw new Error("Employee access package belongs to a different Midnight network");
  if (envelope.contractAddress !== String(current.contractAddress)) throw new Error("Employee access package belongs to a different Blackpay contract");

  const connectedPayoutCommitment = await payoutCommitment(current.wallet.addresses.shieldedAddress);
  if (connectedPayoutCommitment !== payload.payoutCommitmentHex) {
    throw new Error("Connected Lace wallet is not the employee wallet bound to this access package");
  }

  const witness: PrivateEmployeeWitness = {
    salaryMinor: BigInt(payload.salaryMinor),
    payoutCommitmentHex: payload.payoutCommitmentHex,
    saltHex: payload.saltHex,
  };
  const employeeId = hexToBytes32(payload.employeeIdHex, "employee id");
  const expected = current.generated.pureCircuits.employeeCommitment(
    employeeId,
    witness.salaryMinor,
    hexToBytes32(witness.payoutCommitmentHex, "payout commitment"),
    hexToBytes32(witness.saltHex, "employee salt"),
  );
  const ledger = await confirmLedger(current, "employee access import", (value) => value.employees.member(employeeId));
  if (!equalBytes(ledger.employees.lookup(employeeId).commitment, expected)) {
    throw new Error("Employee access package does not match the live employee commitment");
  }

  let state = upsertEmployeeWitness(await getPrivateState(current), payload.employeeIdHex, witness);
  for (const payslip of payload.payslips) {
    state = upsertPortalPayslip(state, {
      employeeIdHex: payload.employeeIdHex,
      payRunIdHex: payslip.payRunIdHex,
      period: payslip.period,
      grossMinor: BigInt(payslip.grossMinor),
      netMinor: BigInt(payslip.netMinor),
      currencyCode: payslip.currencyCode,
      status: payslip.status,
      ...(payslip.paymentTransactionId ? { paymentTransactionId: payslip.paymentTransactionId } : {}),
      createdAt: payslip.createdAt,
    });
  }
  await setPrivateState(current, state);
  return getEmployeePortalSnapshot();
}

export async function getEmployeePortalSnapshot(): Promise<EmployeePortalSnapshot> {
  const current = requireRuntime();
  const state = await getPrivateState(current);
  const connectedPayoutCommitment = await payoutCommitment(current.wallet.addresses.shieldedAddress);
  const match = Object.entries(state.employeeRecords ?? {}).find(
    ([, employee]) => bytesToHex(employee.payoutCommitment) === connectedPayoutCommitment,
  );
  if (!match) {
    throw new Error("No employee access record is installed for this Lace wallet. Import the encrypted package from your employer first.");
  }
  const [employeeIdHex, employee] = match;
  const employeeId = hexToBytes32(employeeIdHex, "employee id");
  const ledger = await confirmLedger(current, "employee portal read", (value) => value.employees.member(employeeId));
  const status = ledger.employees.lookup(employeeId).status === current.generated.EmployeeStatus.Active ? "active" : "inactive";
  return {
    employeeIdHex,
    salaryMinor: employee.salaryMinor,
    status,
    payslips: listPortalPayslips(state, employeeIdHex),
  };
}

export async function getEmployeePortalWitness(): Promise<{ employeeIdHex: string; witness: PrivateEmployeeWitness }> {
  const current = requireRuntime();
  const snapshot = await getEmployeePortalSnapshot();
  const employee = (await getPrivateState(current)).employeeRecords?.[snapshot.employeeIdHex];
  if (!employee) throw new Error("Employee private witness is unavailable");
  return { employeeIdHex: snapshot.employeeIdHex, witness: employeeWitnessFromRecord(employee) };
}

export async function exportBlackpayEncryptedBackup(exportPassword: string) {
  const current = requireRuntime();
  current.providers.privateStateProvider.setContractAddress(current.contractAddress);
  const privateStates = await current.providers.privateStateProvider.exportPrivateStates({ password: exportPassword, maxStates: 32 });
  const signingKeys = await current.providers.privateStateProvider.exportSigningKeys({ password: exportPassword, maxKeys: 32 });
  return {
    format: "blackpay-encrypted-backup-v1" as const,
    networkId: current.wallet.networkId,
    contractAddress: String(current.contractAddress),
    privateStates,
    signingKeys,
  };
}
