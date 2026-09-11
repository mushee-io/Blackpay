import { CompiledContract } from "@midnight-ntwrk/midnight-js-protocol/compact-js";
import { blackpayWitnesses } from "./private-state";

export type BlackpayPayRunLedgerEntry = {
  commitment: Uint8Array;
  period: bigint;
  employeeCount: bigint;
  tokenColor: Uint8Array;
  registeredPaymentCount: bigint;
  fundedPaymentCount: bigint;
  settledPaymentCount: bigint;
  registeredPaymentsRoot: Uint8Array;
  settlementRoot: Uint8Array;
  status: number;
};

export type BlackpayPaymentClaimLedgerEntry = {
  payRunId: Uint8Array;
  employeeCommitment: Uint8Array;
  paymentCommitment: Uint8Array;
  status: number;
};

export type BlackpayLedgerView = {
  protocolVersion: bigint;
  admin: Uint8Array;
  workspaceCreated: boolean;
  workspaceId: Uint8Array;
  currencyId: Uint8Array;
  payrollFrequency: number;
  activeEmployeeCount: bigint;
  employees: {
    member(key: Uint8Array): boolean;
    lookup(key: Uint8Array): { commitment: Uint8Array; status: number; revision: bigint };
  };
  payRuns: {
    member(key: Uint8Array): boolean;
    lookup(key: Uint8Array): BlackpayPayRunLedgerEntry;
  };
  paymentClaims: {
    member(key: Uint8Array): boolean;
    lookup(key: Uint8Array): BlackpayPaymentClaimLedgerEntry;
  };
  incomeProofs: { member(key: Uint8Array): boolean };
  disclosures: {
    member(key: Uint8Array): boolean;
    lookup(key: Uint8Array): { revoked: boolean; expiresAt: bigint; verifierId: Uint8Array };
  };
};

export type GeneratedBlackpayModule = {
  Contract: new (...args: unknown[]) => unknown;
  ledger(state: unknown): BlackpayLedgerView;
  pureCircuits: {
    deriveAdminPublicKey(secret: Uint8Array): Uint8Array;
    employeeCommitment(
      employeeId: Uint8Array,
      salaryMinor: bigint,
      payoutCommitment: Uint8Array,
      payoutCoinPublicKey: Uint8Array,
      salt: Uint8Array,
    ): Uint8Array;
    paymentClaimId(payRunId: Uint8Array, employeeId: Uint8Array): Uint8Array;
    paymentClaimCommitment(
      payRunId: Uint8Array,
      employeeId: Uint8Array,
      amountMinor: bigint,
      payoutCoinPublicKey: Uint8Array,
      tokenColor: Uint8Array,
      paymentSalt: Uint8Array,
    ): Uint8Array;
    paymentRootSeed(payRunId: Uint8Array): Uint8Array;
    appendPaymentRoot(currentRoot: Uint8Array, claimId: Uint8Array, paymentCommitment: Uint8Array): Uint8Array;
    settlementRootSeed(payRunId: Uint8Array): Uint8Array;
    appendSettlementRoot(currentRoot: Uint8Array, claimId: Uint8Array): Uint8Array;
    payRunCommitment(
      payRunId: Uint8Array,
      totalPayrollMinor: bigint,
      paymentsRoot: Uint8Array,
      tokenColor: Uint8Array,
      salt: Uint8Array,
    ): Uint8Array;
  };
  PayrollFrequency: { Weekly: number; Biweekly: number; Monthly: number };
  EmployeeStatus: { Active: number; Inactive: number };
  PayRunStatus: { Draft: number; Approved: number; Executed: number };
  PaymentClaimStatus: { Registered: number; Funded: number; Settled: number };
};

function validateModule(value: unknown): GeneratedBlackpayModule {
  if (!value || typeof value !== "object") throw new Error("Generated Blackpay Compact module did not load");
  const module = value as Partial<GeneratedBlackpayModule>;
  if (typeof module.Contract !== "function") throw new Error("Generated Blackpay Contract export is missing");
  if (typeof module.ledger !== "function") throw new Error("Generated Blackpay ledger decoder is missing");
  const pure = module.pureCircuits;
  if (
    !pure || typeof pure.deriveAdminPublicKey !== "function" || typeof pure.employeeCommitment !== "function" ||
    typeof pure.paymentClaimId !== "function" || typeof pure.paymentClaimCommitment !== "function" ||
    typeof pure.paymentRootSeed !== "function" || typeof pure.appendPaymentRoot !== "function" ||
    typeof pure.payRunCommitment !== "function"
  ) {
    throw new Error("Generated Blackpay v2 pure circuits are missing");
  }
  if (!module.PayrollFrequency || !module.EmployeeStatus || !module.PayRunStatus || !module.PaymentClaimStatus) {
    throw new Error("Generated Blackpay v2 enum exports are missing");
  }
  return module as GeneratedBlackpayModule;
}

export async function loadGeneratedBlackpayModule(): Promise<GeneratedBlackpayModule> {
  if (typeof window === "undefined") throw new Error("Generated Compact bindings can only load in the browser");
  // @ts-ignore -- generated immediately before the production Next build.
  const loaded = await import("../../generated/blackpay/index.js");
  return validateModule(loaded);
}

export async function createCompiledBlackpayContract() {
  const generated = await loadGeneratedBlackpayModule();
  const compiledContract = CompiledContract.make<any>("Blackpay", generated.Contract as any).pipe(
    CompiledContract.withWitnesses(blackpayWitnesses() as any),
    CompiledContract.withCompiledFileAssets(window.location.origin),
  );
  return { generated, compiledContract };
}
