import { deployContract, findDeployedContract, submitCallTx } from "@midnight-ntwrk/midnight-js-contracts";
import type { ContractAddress } from "@midnight-ntwrk/midnight-js-protocol/compact-runtime";
import { bytesToHex, hexToBytes32 } from "./bytes";
import {
  clearPayrollContractGateway,
  registerPayrollContractGateway,
  type PayrollContractGateway,
  type PrivateEmployeeWitness,
  type PrivatePayRunWitness,
} from "./contract-client";
import {
  createCompiledBlackpayContract,
  type GeneratedBlackpayModule,
  type BlackpayLedgerView,
} from "./generated-contract";
import {
  BLACKPAY_PRIVATE_STATE_ID,
  activateEmployeeWitness,
  createInitialBlackpayPrivateState,
  type BlackpayPrivateState,
  upsertEmployeeWitness,
  upsertPayRunWitness,
} from "./private-state";
import { buildBlackpayProviders, type BlackpayProviders, type BlackpayCircuitId } from "./providers";
import type { ConnectedWallet } from "./wallet";
import type { PayrollFrequency } from "../payroll/types";

export type BlackpayRuntimeRole = "admin" | "employee";

export type BlackpayRuntimeStatus = {
  ready: boolean;
  contractAddress?: string;
  role?: BlackpayRuntimeRole;
  networkId?: string;
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
  public: { txId: string; blockHeight: bigint };
  private: { result: unknown };
};

let runtime: LiveRuntime | undefined;

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) diff |= a[index] ^ b[index];
  return diff === 0;
}

function frequencyValue(generated: GeneratedBlackpayModule, frequency: PayrollFrequency): number {
  switch (frequency) {
    case "weekly": return generated.PayrollFrequency.Weekly;
    case "biweekly": return generated.PayrollFrequency.Biweekly;
    case "monthly": return generated.PayrollFrequency.Monthly;
  }
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
  let lastLedger: BlackpayLedgerView | null = null;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    lastLedger = await queryLedger(current);
    if (lastLedger && predicate(lastLedger)) return lastLedger;
    await new Promise((resolve) => window.setTimeout(resolve, 500));
  }
  if (!lastLedger) throw new Error(`Midnight indexer did not return Blackpay state after ${description}`);
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

async function submitCircuit(
  current: LiveRuntime,
  circuitId: BlackpayCircuitId,
  args: unknown[],
): Promise<FinalizedCall> {
  const result = await submitCallTx(current.providers as any, {
    compiledContract: current.compiledContract,
    contractAddress: current.contractAddress,
    circuitId,
    args,
    privateStateId: BLACKPAY_PRIVATE_STATE_ID,
  } as any);
  if (!result.public.txId) throw new Error(`Midnight returned no transaction ID for ${circuitId}`);
  return result as FinalizedCall;
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
      const before = await getPrivateState(current);
      const next = upsertEmployeeWitness(before, input.employeeIdHex, input.witness);
      await setPrivateState(current, next);
      const expectedCommitment = current.generated.pureCircuits.employeeCommitment(
        employeeId,
        input.witness.salaryMinor,
        hexToBytes32(input.witness.payoutCommitmentHex, "payout commitment"),
        hexToBytes32(input.witness.saltHex, "employee salt"),
      );
      const result = await submitCircuit(current, "addEmployee", [employeeId]);
      await confirmLedger(current, "employee commitment", (ledger) =>
        ledger.employees.member(employeeId) && equalBytes(ledger.employees.lookup(employeeId).commitment, expectedCommitment),
      );
      return { transactionId: result.public.txId };
    },

    async updateEmployee(input) {
      requireAdmin(current);
      const employeeId = hexToBytes32(input.employeeIdHex, "employee id");
      const before = await getPrivateState(current);
      const next = upsertEmployeeWitness(before, input.employeeIdHex, input.witness);
      await setPrivateState(current, next);
      const expectedCommitment = current.generated.pureCircuits.employeeCommitment(
        employeeId,
        input.witness.salaryMinor,
        hexToBytes32(input.witness.payoutCommitmentHex, "payout commitment"),
        hexToBytes32(input.witness.saltHex, "employee salt"),
      );
      const result = await submitCircuit(current, "updateEmployee", [employeeId]);
      await confirmLedger(current, "employee update", (ledger) =>
        ledger.employees.member(employeeId) && equalBytes(ledger.employees.lookup(employeeId).commitment, expectedCommitment),
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
      const before = await getPrivateState(current);
      await setPrivateState(current, upsertPayRunWitness(before, input.payRunIdHex, input.witness));
      const expectedCommitment = current.generated.pureCircuits.payRunCommitment(
        payRunId,
        input.witness.totalPayrollMinor,
        hexToBytes32(input.witness.paymentsRootHex, "payments root"),
        hexToBytes32(input.witness.saltHex, "pay-run salt"),
      );
      const result = await submitCircuit(current, "createPayRun", [
        payRunId,
        BigInt(input.period),
        BigInt(input.employeeCount),
      ]);
      await confirmLedger(current, "pay-run creation", (ledger) =>
        ledger.payRuns.member(payRunId) &&
        ledger.payRuns.lookup(payRunId).status === current.generated.PayRunStatus.Draft &&
        equalBytes(ledger.payRuns.lookup(payRunId).commitment, expectedCommitment),
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
      return { transactionId: result.public.txId };
    },

    async proveIncomeAtLeast(input) {
      const employeeId = hexToBytes32(input.employeeIdHex, "employee id");
      const before = await getPrivateState(current);
      await setPrivateState(current, upsertEmployeeWitness(before, input.employeeIdHex, input.witness));
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
      const before = await getPrivateState(current);
      await setPrivateState(current, upsertEmployeeWitness(before, input.employeeIdHex, input.witness));
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
      const before = await getPrivateState(current);
      await setPrivateState(current, upsertEmployeeWitness(before, input.employeeIdHex, input.witness));
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
      const before = await getPrivateState(current);
      const withWitness = input.witness
        ? upsertEmployeeWitness(before, input.employeeIdHex, input.witness)
        : activateEmployeeWitness(before, input.employeeIdHex);
      await setPrivateState(current, withWitness);
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
    const initialPrivateState = createInitialBlackpayPrivateState();
    const deployed = await deployContract(providers as any, {
      compiledContract,
      privateStateId: BLACKPAY_PRIVATE_STATE_ID,
      initialPrivateState,
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
  const current = requireRuntime();
  return confirmLedger(current, "ledger read", () => true);
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
