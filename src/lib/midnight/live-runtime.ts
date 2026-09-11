import { deployContract, findDeployedContract, submitCallTx } from "@midnight-ntwrk/midnight-js-contracts";
import type { ContractAddress } from "@midnight-ntwrk/midnight-js-protocol/compact-runtime";
import { bytesToHex, hexToBytes32, randomBytes32 } from "./bytes";
import {
  clearPayrollContractGateway,
  registerPayrollContractGateway,
  type PayrollContractGateway,
  type PrivateEmployeeWitness,
  type PrivateSettlementPayment,
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
  activateFundedCoinCandidate,
  activatePayRunWitness,
  attachFundedCoin,
  createInitialBlackpayPrivateState,
  employeeWitnessFromRecord,
  getSettlementPayment,
  listPortalPayslips,
  listSettlementPaymentsForPayRun,
  setPrivateWorkspaceCurrency,
  type BlackpayPortalPayslipRecord,
  type BlackpayPrivateState,
  updatePortalPayRunStatus,
  upsertEmployeeWitness,
  upsertPayRunWitness,
  upsertPortalPayslip,
  upsertSettlementPayment,
} from "./private-state";
import { buildBlackpayProviders, type BlackpayProviders, type BlackpayCircuitId } from "./providers";
import { captureCommitmentCandidates } from "./settlement-indexer";
import { connectedShieldedCoinPublicKeyHex } from "./shielded-address";
import { assertWalletStillConnected, type ConnectedWallet } from "./wallet";
import { payoutCommitment } from "../payroll/commitments";
import type { PayrollFrequency, PrivatePayrollPayment } from "../payroll/types";

export type BlackpayRuntimeRole = "admin" | "employee";
export type BlackpayRuntimeStatus = {
  ready: boolean;
  contractAddress?: string;
  role?: BlackpayRuntimeRole;
  networkId?: string;
  protocolVersion?: number;
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

function protocolVersionIsV2(ledger: BlackpayLedgerView): boolean {
  return BigInt(ledger.protocolVersion) === 2n;
}

function requireProtocolV2(ledger: BlackpayLedgerView): void {
  if (!protocolVersionIsV2(ledger)) {
    throw new Error("This contract is not Blackpay protocol v2. Settlement binding requires a newly deployed v2 contract.");
  }
}

async function queryLedger(current: LiveRuntime): Promise<BlackpayLedgerView | null> {
  await assertWalletStillConnected(current.wallet);
  const state = await current.providers.publicDataProvider.queryContractState(current.contractAddress);
  if (!state) return null;
  try {
    return current.generated.ledger(state.data);
  } catch {
    throw new Error("The deployed contract is not compatible with Blackpay protocol v2. Deploy a new Blackpay v2 contract instead of joining the legacy v1 address.");
  }
}

async function confirmLedger(
  current: LiveRuntime,
  description: string,
  predicate: (ledger: BlackpayLedgerView) => boolean,
): Promise<BlackpayLedgerView> {
  let latest: BlackpayLedgerView | null = null;
  for (let attempt = 0; attempt < 24; attempt += 1) {
    latest = await queryLedger(current);
    if (latest) {
      requireProtocolV2(latest);
      if (predicate(latest)) return latest;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 500));
  }
  if (!latest) throw new Error(`Midnight indexer did not return Blackpay v2 state after ${description}`);
  throw new Error(`Blackpay v2 state did not confirm ${description} after transaction finalization`);
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
  await assertWalletStillConnected(current.wallet);
  current.providers.privateStateProvider.setContractAddress(current.contractAddress);
  const state = await current.providers.privateStateProvider.get(BLACKPAY_PRIVATE_STATE_ID);
  if (!state) throw new Error("Blackpay encrypted private state is missing. Restore an encrypted backup before continuing.");
  return state;
}

async function setPrivateState(current: LiveRuntime, state: BlackpayPrivateState): Promise<void> {
  await assertWalletStillConnected(current.wallet);
  current.providers.privateStateProvider.setContractAddress(current.contractAddress);
  await current.providers.privateStateProvider.set(BLACKPAY_PRIVATE_STATE_ID, state);
}

async function submitCircuit(current: LiveRuntime, circuitId: BlackpayCircuitId, args: unknown[]): Promise<FinalizedCall> {
  await assertWalletStillConnected(current.wallet);
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

function claimStatusForPayslip(current: LiveRuntime, ledger: BlackpayLedgerView, payRunId: Uint8Array, employeeId: Uint8Array): BlackpayPortalPayslipRecord["status"] {
  if (!ledger.payRuns.member(payRunId)) return "pending";
  const claimId = current.generated.pureCircuits.paymentClaimId(payRunId, employeeId);
  if (ledger.paymentClaims.member(claimId)) {
    const claim = ledger.paymentClaims.lookup(claimId);
    if (claim.status === current.generated.PaymentClaimStatus.Settled) return "paid";
    if (claim.status === current.generated.PaymentClaimStatus.Funded) return "funded";
  }
  const run = ledger.payRuns.lookup(payRunId);
  if (run.status === current.generated.PayRunStatus.Executed) return "paid";
  if (run.status === current.generated.PayRunStatus.Approved) return "approved";
  return "pending";
}

function gatewayFor(current: LiveRuntime): PayrollContractGateway {
  return {
    async createWorkspace(input) {
      requireAdmin(current);
      const workspaceId = hexToBytes32(input.workspaceIdHex, "workspace id");
      const currencyId = hexToBytes32(input.currencyIdHex, "currency id");
      const result = await submitCircuit(current, "createWorkspace", [workspaceId, currencyId, frequencyValue(current.generated, input.frequency)]);
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
        hexToBytes32(input.witness.payoutCoinPublicKeyHex, "payout coin public key"),
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
        hexToBytes32(input.witness.payoutCoinPublicKeyHex, "payout coin public key"),
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
      if (!Number.isSafeInteger(input.period) || input.period <= 0 || input.period > 0xffffffff) throw new Error("Pay period must be a positive Uint32 value");
      if (!Array.isArray(input.payments) || input.payments.length === 0 || input.payments.length > 0xffffffff) throw new Error("Pay run requires at least one private payment");
      const payRunId = hexToBytes32(input.payRunIdHex, "pay-run id");
      const tokenColor = hexToBytes32(input.tokenColorHex, "payroll token color");
      const payments = [...input.payments].sort((a, b) => a.employeeIdHex.localeCompare(b.employeeIdHex));
      const uniqueEmployees = new Set(payments.map((payment) => payment.employeeIdHex.toLowerCase()));
      if (uniqueEmployees.size !== payments.length) throw new Error("A pay run cannot contain duplicate employee payments");

      let root = current.generated.pureCircuits.paymentRootSeed(payRunId);
      let totalPayrollMinor = 0n;
      const prepared: Array<{ payment: PrivateSettlementPayment; claimIdHex: string; paymentCommitment: Uint8Array }> = [];
      for (const payment of payments) {
        if (payment.amountMinor <= 0n || payment.amountMinor > ((1n << 64n) - 1n)) throw new Error("Private payroll amount is outside Uint64 range");
        const employeeId = hexToBytes32(payment.employeeIdHex, "employee id");
        const payoutKey = hexToBytes32(payment.payoutCoinPublicKeyHex, "payout coin public key");
        const paymentSalt = hexToBytes32(payment.paymentSaltHex, "payment salt");
        const claimId = current.generated.pureCircuits.paymentClaimId(payRunId, employeeId);
        const paymentCommitment = current.generated.pureCircuits.paymentClaimCommitment(
          payRunId,
          employeeId,
          payment.amountMinor,
          payoutKey,
          tokenColor,
          paymentSalt,
        );
        root = current.generated.pureCircuits.appendPaymentRoot(root, claimId, paymentCommitment);
        totalPayrollMinor += payment.amountMinor;
        prepared.push({ payment, claimIdHex: bytesToHex(claimId), paymentCommitment });
      }
      if (totalPayrollMinor <= 0n || totalPayrollMinor > ((1n << 128n) - 1n)) throw new Error("Private payroll total is outside Uint128 range");

      const payRunSalt = randomBytes32();
      const witness = { totalPayrollMinor, paymentsRootHex: bytesToHex(root), saltHex: bytesToHex(payRunSalt) };
      let privateState = upsertPayRunWitness(await getPrivateState(current), input.payRunIdHex, witness);
      for (const item of prepared) {
        privateState = upsertSettlementPayment(privateState, {
          ...item.payment,
          claimIdHex: item.claimIdHex,
          payRunIdHex: input.payRunIdHex,
          tokenColorHex: input.tokenColorHex,
        });
      }
      await setPrivateState(current, privateState);

      const expectedRunCommitment = current.generated.pureCircuits.payRunCommitment(
        payRunId,
        totalPayrollMinor,
        root,
        tokenColor,
        payRunSalt,
      );
      const createResult = await submitCircuit(current, "createPayRun", [payRunId, BigInt(input.period), BigInt(payments.length), tokenColor]);
      await confirmLedger(current, "pay-run creation", (ledger) => {
        if (!ledger.payRuns.member(payRunId)) return false;
        const run = ledger.payRuns.lookup(payRunId);
        return run.status === current.generated.PayRunStatus.Draft &&
          run.registeredPaymentCount === 0n &&
          equalBytes(run.tokenColor, tokenColor) &&
          equalBytes(run.commitment, expectedRunCommitment);
      });

      const registrationTransactionIds: string[] = [];
      for (const item of prepared) {
        const employeeId = hexToBytes32(item.payment.employeeIdHex, "employee id");
        await setPrivateState(current, activateEmployeeWitness(await getPrivateState(current), item.payment.employeeIdHex));
        const result = await submitCircuit(current, "registerPayRunPayment", [
          payRunId,
          employeeId,
          item.payment.amountMinor,
          hexToBytes32(item.payment.payoutCoinPublicKeyHex, "payout coin public key"),
          hexToBytes32(item.payment.paymentSaltHex, "payment salt"),
        ]);
        registrationTransactionIds.push(result.public.txId);
        const claimId = hexToBytes32(item.claimIdHex, "claim id");
        await confirmLedger(current, "private payment registration", (ledger) =>
          ledger.paymentClaims.member(claimId) &&
          ledger.paymentClaims.lookup(claimId).status === current.generated.PaymentClaimStatus.Registered &&
          equalBytes(ledger.paymentClaims.lookup(claimId).paymentCommitment, item.paymentCommitment),
        );
      }
      await confirmLedger(current, "complete pay-run payment registration", (ledger) => {
        const run = ledger.payRuns.lookup(payRunId);
        return run.registeredPaymentCount === BigInt(payments.length) && equalBytes(run.registeredPaymentsRoot, root);
      });
      return { transactionId: createResult.public.txId, registrationTransactionIds };
    },

    async approvePayRun(payRunIdHex) {
      requireAdmin(current);
      const payRunId = hexToBytes32(payRunIdHex, "pay-run id");
      await setPrivateState(current, activatePayRunWitness(await getPrivateState(current), payRunIdHex));
      const result = await submitCircuit(current, "approvePayRun", [payRunId]);
      await confirmLedger(current, "pay-run approval", (ledger) => {
        if (!ledger.payRuns.member(payRunId)) return false;
        const run = ledger.payRuns.lookup(payRunId);
        return run.status === current.generated.PayRunStatus.Approved && run.registeredPaymentCount === run.employeeCount;
      });
      await setPrivateState(current, updatePortalPayRunStatus(await getPrivateState(current), payRunIdHex, "approved"));
      return { transactionId: result.public.txId };
    },

    async fundPayRunPayment(input) {
      requireAdmin(current);
      const payRunId = hexToBytes32(input.payRunIdHex, "pay-run id");
      const employeeId = hexToBytes32(input.employeeIdHex, "employee id");
      const state = await getPrivateState(current);
      const payment = getSettlementPayment(state, input.payRunIdHex, input.employeeIdHex);
      const claimId = hexToBytes32(payment.claimIdHex, "claim id");
      const before = await confirmLedger(current, "payment funding precheck", (ledger) =>
        ledger.payRuns.member(payRunId) && ledger.paymentClaims.member(claimId),
      );
      const claimBefore = before.paymentClaims.lookup(claimId);
      if (claimBefore.status === current.generated.PaymentClaimStatus.Settled) throw new Error("This payroll claim is already settled");
      if (claimBefore.status === current.generated.PaymentClaimStatus.Funded && payment.fundedCoin?.mtIndexCandidates.length) {
        return { transactionId: "already-funded", claimIdHex: payment.claimIdHex, candidateMtIndices: payment.fundedCoin.mtIndexCandidates.map(String) };
      }
      if (claimBefore.status !== current.generated.PaymentClaimStatus.Registered) throw new Error("This payroll claim is not in a fundable state");

      const fundingCoin = {
        nonce: randomBytes32(),
        color: new Uint8Array(payment.tokenColor),
        value: payment.amountMinor,
      };
      const result = await submitCircuit(current, "fundPayRunPayment", [
        payRunId,
        employeeId,
        payment.amountMinor,
        new Uint8Array(payment.payoutCoinPublicKey),
        new Uint8Array(payment.paymentSalt),
        fundingCoin,
      ]);
      await confirmLedger(current, "contract-bound payroll funding", (ledger) =>
        ledger.paymentClaims.member(claimId) && ledger.paymentClaims.lookup(claimId).status === current.generated.PaymentClaimStatus.Funded,
      );
      const candidates = await captureCommitmentCandidates(current.wallet.configuration.indexerUri, result.public.txId);
      const nextState = attachFundedCoin(await getPrivateState(current), payment.claimIdHex, {
        nonceHex: bytesToHex(fundingCoin.nonce),
        colorHex: bytesToHex(fundingCoin.color),
        value: fundingCoin.value,
        mtIndexCandidates: candidates,
      });
      await setPrivateState(current, updatePortalPayRunStatus(nextState, input.payRunIdHex, "funded"));
      return { transactionId: result.public.txId, claimIdHex: payment.claimIdHex, candidateMtIndices: candidates.map(String) };
    },

    async claimPayRunPayment(input) {
      const payRunId = hexToBytes32(input.payRunIdHex, "pay-run id");
      const employeeId = hexToBytes32(input.employeeIdHex, "employee id");
      let state = await getPrivateState(current);
      const payment = getSettlementPayment(state, input.payRunIdHex, input.employeeIdHex);
      const connectedCoinKey = connectedShieldedCoinPublicKeyHex(current.wallet.addresses.shieldedCoinPublicKey, current.wallet.networkId);
      if (connectedCoinKey !== bytesToHex(payment.payoutCoinPublicKey)) {
        throw new Error("Connected Lace wallet is not the fixed payout wallet for this payroll claim");
      }
      if (!payment.fundedCoin?.mtIndexCandidates.length) {
        throw new Error("This payroll claim is not ready to claim. Ask the employer to fund it and export a fresh employee access package.");
      }
      const claimId = hexToBytes32(payment.claimIdHex, "claim id");
      const ledgerBefore = await confirmLedger(current, "employee settlement precheck", (ledger) => ledger.paymentClaims.member(claimId));
      const claimBefore = ledgerBefore.paymentClaims.lookup(claimId);
      if (claimBefore.status === current.generated.PaymentClaimStatus.Settled) {
        await setPrivateState(current, updatePortalPayRunStatus(state, input.payRunIdHex, "paid"));
        throw new Error("This payroll claim is already settled on-chain");
      }
      if (claimBefore.status !== current.generated.PaymentClaimStatus.Funded) throw new Error("This payroll claim has not been funded by the employer");

      let lastError: Error | undefined;
      for (const mtIndex of payment.fundedCoin.mtIndexCandidates) {
        state = activateFundedCoinCandidate(await getPrivateState(current), payment.claimIdHex, mtIndex);
        await setPrivateState(current, state);
        try {
          const result = await submitCircuit(current, "claimPayRunPayment", [
            payRunId,
            employeeId,
            payment.amountMinor,
            new Uint8Array(payment.payoutCoinPublicKey),
            new Uint8Array(payment.paymentSalt),
          ]);
          await confirmLedger(current, "employee shielded payroll claim", (ledger) =>
            ledger.paymentClaims.member(claimId) && ledger.paymentClaims.lookup(claimId).status === current.generated.PaymentClaimStatus.Settled,
          );
          await setPrivateState(current, updatePortalPayRunStatus(await getPrivateState(current), input.payRunIdHex, "paid", result.public.txId));
          return { transactionId: result.public.txId, claimIdHex: payment.claimIdHex };
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));
          const latest = await queryLedger(current).catch(() => null);
          if (latest && latest.paymentClaims.member(claimId) && latest.paymentClaims.lookup(claimId).status === current.generated.PaymentClaimStatus.Settled) {
            await setPrivateState(current, updatePortalPayRunStatus(await getPrivateState(current), input.payRunIdHex, "paid"));
            throw new Error("Payroll claim settled on-chain, but the submitting transaction ID could not be recovered. Refresh the employee portal before retrying.");
          }
        }
      }
      throw lastError ?? new Error("No funded-coin commitment-tree candidate could prove the payroll claim");
    },

    async proveIncomeAtLeast(input) {
      const employeeId = hexToBytes32(input.employeeIdHex, "employee id");
      await setPrivateState(current, upsertEmployeeWitness(await getPrivateState(current), input.employeeIdHex, input.witness));
      const result = await submitCircuit(current, "proveIncomeAtLeast", [employeeId, input.thresholdMinor, hexToBytes32(input.nonceHex, "proof nonce")]);
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
      await setPrivateState(current, upsertEmployeeWitness(await getPrivateState(current), input.employeeIdHex, input.witness));
      const result = await submitCircuit(current, "revokeDisclosure", [employeeId, disclosureId]);
      await confirmLedger(current, "disclosure revocation", (ledger) => ledger.disclosures.member(disclosureId) && ledger.disclosures.lookup(disclosureId).revoked);
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
    if (!params.contractAddress?.trim()) throw new Error("A deployed Blackpay v2 contract address is required to join");
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
  const current: LiveRuntime = { wallet: params.wallet, providers, compiledContract, generated, contractAddress, role: "employee" };
  runtime = current;
  try {
    const ledger = await confirmLedger(current, "Blackpay v2 initialization", () => true);
    requireProtocolV2(ledger);
    current.role = await determineRole(current);
    registerPayrollContractGateway(gatewayFor(current));
  } catch (error) {
    clearBlackpayLiveRuntime();
    throw error;
  }
  return { contractAddress: String(contractAddress), role: current.role, deploymentTransactionId };
}

export function clearBlackpayLiveRuntime(): void {
  runtime = undefined;
  clearPayrollContractGateway();
}

export function getBlackpayRuntimeStatus(): BlackpayRuntimeStatus {
  if (!runtime) return { ready: false };
  return { ready: true, contractAddress: String(runtime.contractAddress), role: runtime.role, networkId: runtime.wallet.networkId, protocolVersion: 2 };
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
    if (recipientCommitment !== bytesToHex(employee.payoutCommitment)) throw new Error("Pay-run recipient does not match the employee wallet bound during registration");
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
  const ledger = await confirmLedger(current, "private payslip issuance", (value) => value.employees.member(employeeId) && value.payRuns.member(payRunId));
  const status = claimStatusForPayslip(current, ledger, payRunId, employeeId);
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

export async function exportEmployeeAccessPackage(params: { employeeIdHex: string; accessPassword: string }): Promise<EmployeeAccessEnvelope> {
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
    employee.payoutCoinPublicKey,
    employee.salt,
  );
  if (!equalBytes(publicEntry.commitment, expected)) throw new Error("Encrypted employee record does not match the live Blackpay v2 employee commitment");

  const settlementCapabilities = Object.values(state.settlementPayments ?? {})
    .filter((payment) => payment.employeeIdHex === params.employeeIdHex)
    .map((payment) => ({
      claimIdHex: payment.claimIdHex,
      payRunIdHex: payment.payRunIdHex,
      employeeIdHex: payment.employeeIdHex,
      amountMinor: payment.amountMinor.toString(),
      payoutCoinPublicKeyHex: bytesToHex(payment.payoutCoinPublicKey),
      paymentSaltHex: bytesToHex(payment.paymentSalt),
      tokenColorHex: bytesToHex(payment.tokenColor),
      ...(payment.fundedCoin?.mtIndexCandidates.length ? {
        fundedCoin: {
          nonceHex: bytesToHex(payment.fundedCoin.nonce),
          colorHex: bytesToHex(payment.fundedCoin.color),
          value: payment.fundedCoin.value.toString(),
          mtIndexCandidates: payment.fundedCoin.mtIndexCandidates.map(String),
        },
      } : {}),
    }));

  return encryptEmployeeAccessPayload({
    networkId: current.wallet.networkId,
    contractAddress: String(current.contractAddress),
    password: params.accessPassword,
    payload: {
      employeeIdHex: params.employeeIdHex,
      salaryMinor: employee.salaryMinor.toString(),
      payoutCommitmentHex: bytesToHex(employee.payoutCommitment),
      payoutCoinPublicKeyHex: bytesToHex(employee.payoutCoinPublicKey),
      saltHex: bytesToHex(employee.salt),
      settlementCapabilities,
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

export async function importEmployeeAccessPackage(envelopeValue: unknown, accessPassword: string): Promise<EmployeePortalSnapshot> {
  const current = requireRuntime();
  const { envelope, payload } = await decryptEmployeeAccessPayload(envelopeValue, accessPassword);
  if (envelope.networkId !== current.wallet.networkId) throw new Error("Employee access package belongs to a different Midnight network");
  if (envelope.contractAddress !== String(current.contractAddress)) throw new Error("Employee access package belongs to a different Blackpay contract");
  if (payload.version !== "blackpay-employee-access-v3") throw new Error("Blackpay protocol v2 settlement requires a fresh v3 employee access package from the employer");

  const connectedPayoutCommitment = await payoutCommitment(current.wallet.addresses.shieldedAddress);
  if (connectedPayoutCommitment !== payload.payoutCommitmentHex) throw new Error("Connected Lace wallet is not the employee wallet bound to this access package");
  const connectedCoinKey = connectedShieldedCoinPublicKeyHex(current.wallet.addresses.shieldedCoinPublicKey, current.wallet.networkId);
  if (connectedCoinKey !== payload.payoutCoinPublicKeyHex) throw new Error("Connected Lace wallet coin key does not match this employee access package");

  const witness: PrivateEmployeeWitness = {
    salaryMinor: BigInt(payload.salaryMinor),
    payoutCommitmentHex: payload.payoutCommitmentHex,
    payoutCoinPublicKeyHex: payload.payoutCoinPublicKeyHex,
    saltHex: payload.saltHex,
  };
  const employeeId = hexToBytes32(payload.employeeIdHex, "employee id");
  const expected = current.generated.pureCircuits.employeeCommitment(
    employeeId,
    witness.salaryMinor,
    hexToBytes32(witness.payoutCommitmentHex, "payout commitment"),
    hexToBytes32(witness.payoutCoinPublicKeyHex, "payout coin public key"),
    hexToBytes32(witness.saltHex, "employee salt"),
  );
  const ledger = await confirmLedger(current, "employee access import", (value) => value.employees.member(employeeId));
  const employeeEntry = ledger.employees.lookup(employeeId);
  if (!equalBytes(employeeEntry.commitment, expected)) throw new Error("Employee access package does not match the live Blackpay v2 employee commitment");

  let state = upsertEmployeeWitness(await getPrivateState(current), payload.employeeIdHex, witness);
  for (const capability of payload.settlementCapabilities) {
    const payRunId = hexToBytes32(capability.payRunIdHex, "pay-run id");
    const claimId = hexToBytes32(capability.claimIdHex, "claim id");
    if (!ledger.payRuns.member(payRunId) || !ledger.paymentClaims.member(claimId)) throw new Error("Employee access package contains a settlement claim that does not exist on the live contract");
    const paymentCommitment = current.generated.pureCircuits.paymentClaimCommitment(
      payRunId,
      employeeId,
      BigInt(capability.amountMinor),
      hexToBytes32(capability.payoutCoinPublicKeyHex, "payout coin public key"),
      hexToBytes32(capability.tokenColorHex, "token color"),
      hexToBytes32(capability.paymentSaltHex, "payment salt"),
    );
    const liveClaim = ledger.paymentClaims.lookup(claimId);
    if (!equalBytes(liveClaim.employeeCommitment, employeeEntry.commitment) || !equalBytes(liveClaim.paymentCommitment, paymentCommitment)) {
      throw new Error("Employee settlement capability does not match the live private-payment commitment");
    }
    state = upsertSettlementPayment(state, {
      claimIdHex: capability.claimIdHex,
      payRunIdHex: capability.payRunIdHex,
      employeeIdHex: capability.employeeIdHex,
      amountMinor: BigInt(capability.amountMinor),
      payoutCoinPublicKeyHex: capability.payoutCoinPublicKeyHex,
      paymentSaltHex: capability.paymentSaltHex,
      tokenColorHex: capability.tokenColorHex,
    });
    if (capability.fundedCoin) {
      state = attachFundedCoin(state, capability.claimIdHex, {
        nonceHex: capability.fundedCoin.nonceHex,
        colorHex: capability.fundedCoin.colorHex,
        value: BigInt(capability.fundedCoin.value),
        mtIndexCandidates: capability.fundedCoin.mtIndexCandidates.map(BigInt),
      });
    }
  }
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
  const match = Object.entries(state.employeeRecords ?? {}).find(([, employee]) => bytesToHex(employee.payoutCommitment) === connectedPayoutCommitment);
  if (!match) throw new Error("No employee access record is installed for this Lace wallet. Import the encrypted package from your employer first.");
  const [employeeIdHex, employee] = match;
  const connectedCoinKey = connectedShieldedCoinPublicKeyHex(current.wallet.addresses.shieldedCoinPublicKey, current.wallet.networkId);
  if (connectedCoinKey !== bytesToHex(employee.payoutCoinPublicKey)) throw new Error("Connected Lace payout key no longer matches the installed employee record");
  const employeeId = hexToBytes32(employeeIdHex, "employee id");
  const ledger = await confirmLedger(current, "employee portal read", (value) => value.employees.member(employeeId));
  const status = ledger.employees.lookup(employeeId).status === current.generated.EmployeeStatus.Active ? "active" : "inactive";
  const payslips = listPortalPayslips(state, employeeIdHex).map((payslip) => ({
    ...payslip,
    status: claimStatusForPayslip(current, ledger, hexToBytes32(payslip.payRunIdHex, "pay-run id"), employeeId),
  }));
  return { employeeIdHex, salaryMinor: employee.salaryMinor, status, payslips };
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
  await assertWalletStillConnected(current.wallet);
  current.providers.privateStateProvider.setContractAddress(current.contractAddress);
  const privateStates = await current.providers.privateStateProvider.exportPrivateStates({ password: exportPassword, maxStates: 32 });
  const signingKeys = await current.providers.privateStateProvider.exportSigningKeys({ password: exportPassword, maxKeys: 32 });
  return { format: "blackpay-encrypted-backup-v1" as const, networkId: current.wallet.networkId, contractAddress: String(current.contractAddress), privateStates, signingKeys };
}
