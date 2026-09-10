import { CompiledContract } from "@midnight-ntwrk/midnight-js-protocol/compact-js";
import { blackpayWitnesses } from "./private-state";

export type BlackpayLedgerView = {
  workspaceCreated: boolean;
  activeEmployeeCount: bigint;
  employees: {
    member(key: Uint8Array): boolean;
    lookup(key: Uint8Array): { status: number; revision: bigint };
  };
  payRuns: {
    member(key: Uint8Array): boolean;
    lookup(key: Uint8Array): { status: number; transactionCommitment: Uint8Array };
  };
  incomeProofs: {
    member(key: Uint8Array): boolean;
  };
  disclosures: {
    member(key: Uint8Array): boolean;
    lookup(key: Uint8Array): { revoked: boolean; expiresAt: bigint; verifierId: Uint8Array };
  };
};

export type GeneratedBlackpayModule = {
  Contract: new (...args: unknown[]) => unknown;
  ledger(state: unknown): BlackpayLedgerView;
  PayrollFrequency: { Weekly: number; Biweekly: number; Monthly: number };
  EmployeeStatus: { Active: number; Inactive: number };
  PayRunStatus: { Draft: number; Approved: number; Executed: number };
};

function validateModule(value: unknown): GeneratedBlackpayModule {
  if (!value || typeof value !== "object") throw new Error("Generated Blackpay Compact module did not load");
  const module = value as Partial<GeneratedBlackpayModule>;
  if (typeof module.Contract !== "function") throw new Error("Generated Blackpay Contract export is missing");
  if (typeof module.ledger !== "function") throw new Error("Generated Blackpay ledger decoder is missing");
  if (!module.PayrollFrequency || !module.EmployeeStatus || !module.PayRunStatus) {
    throw new Error("Generated Blackpay enum exports are missing");
  }
  return module as GeneratedBlackpayModule;
}

export async function loadGeneratedBlackpayModule(): Promise<GeneratedBlackpayModule> {
  if (typeof window === "undefined") throw new Error("Generated Compact bindings can only load in the browser");
  const url = new URL("/compact/blackpay.generated.js", window.location.origin).href;
  const loaded = await import(/* webpackIgnore: true */ url);
  return validateModule(loaded);
}

export async function createCompiledBlackpayContract() {
  const generated = await loadGeneratedBlackpayModule();
  const compiledContract = CompiledContract.make<any>(
    "Blackpay",
    generated.Contract as any,
  ).pipe(
    CompiledContract.withWitnesses(blackpayWitnesses() as any),
    CompiledContract.withCompiledFileAssets(window.location.origin),
  );
  return { generated, compiledContract };
}
