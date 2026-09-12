import { CompiledContract } from "@midnight-ntwrk/midnight-js-protocol/compact-js";
import { invoiceWitnesses } from "./invoice-private-state";

export type InvoiceLedgerEntry = {
  commitment: Uint8Array;
  tokenColor: Uint8Array;
  status: number;
  acceptanceNullifier: Uint8Array;
  paymentNullifier: Uint8Array;
};

export type InvoiceLedgerView = {
  protocolVersion: bigint;
  invoices: {
    member(key: Uint8Array): boolean;
    lookup(key: Uint8Array): InvoiceLedgerEntry;
  };
  usedNullifiers: { member(key: Uint8Array): boolean };
};

export type GeneratedInvoiceModule = {
  Contract: new (...args: unknown[]) => unknown;
  ledger(state: unknown): InvoiceLedgerView;
  pureCircuits: {
    derivePayerCommitment(secret: Uint8Array): Uint8Array;
    invoiceCommitment(
      invoiceId: Uint8Array,
      amountMinor: bigint,
      taxMinor: bigint,
      payerCommitment: Uint8Array,
      supplierCoinPublicKey: Uint8Array,
      dueAt: bigint,
      salt: Uint8Array,
    ): Uint8Array;
    invoiceAcceptanceNullifier(invoiceId: Uint8Array, commitment: Uint8Array, nonce: Uint8Array): Uint8Array;
    invoicePaymentNullifier(invoiceId: Uint8Array, commitment: Uint8Array, nonce: Uint8Array): Uint8Array;
  };
  InvoiceStatus: { Created: number; Accepted: number; Funded: number; Paid: number; Cancelled: number };
};

function validateModule(value: unknown): GeneratedInvoiceModule {
  if (!value || typeof value !== "object") throw new Error("Generated Blackout Invoice Compact module did not load");
  const module = value as Partial<GeneratedInvoiceModule>;
  if (typeof module.Contract !== "function") throw new Error("Generated Blackout Invoice Contract export is missing");
  if (typeof module.ledger !== "function") throw new Error("Generated Blackout Invoice ledger decoder is missing");
  if (!module.pureCircuits || typeof module.pureCircuits.derivePayerCommitment !== "function" ||
      typeof module.pureCircuits.invoiceCommitment !== "function" ||
      typeof module.pureCircuits.invoiceAcceptanceNullifier !== "function" ||
      typeof module.pureCircuits.invoicePaymentNullifier !== "function") {
    throw new Error("Generated Blackout Invoice pure circuits are missing");
  }
  if (!module.InvoiceStatus) throw new Error("Generated Blackout Invoice status enum is missing");
  return module as GeneratedInvoiceModule;
}

export async function loadGeneratedInvoiceModule(): Promise<GeneratedInvoiceModule> {
  if (typeof window === "undefined") throw new Error("Generated invoice bindings can only load in the browser");
  // @ts-ignore -- generated immediately before the production Next build.
  const loaded = await import("../../generated/invoice/index.js");
  return validateModule(loaded);
}

export async function createCompiledInvoiceContract() {
  const generated = await loadGeneratedInvoiceModule();
  const compiledContract = CompiledContract.make<any>("BlackoutInvoice", generated.Contract as any).pipe(
    CompiledContract.withWitnesses(invoiceWitnesses() as any),
    CompiledContract.withCompiledFileAssets(`${window.location.origin}/invoice`),
  );
  return { generated, compiledContract };
}
