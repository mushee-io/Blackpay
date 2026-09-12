export type InvoiceVisibility = "PUBLIC" | "PRIVATE" | "COMMITTED" | "SELECTIVELY_DISCLOSABLE";

export type InvoiceStatus = "CREATED" | "ACCEPTED" | "FUNDED" | "PAID" | "CANCELLED";

export type PrivateInvoiceWitness = {
  amountMinor: bigint;
  taxMinor: bigint;
  payerCommitmentHex: string;
  supplierCoinPublicKeyHex: string;
  dueAt: bigint;
  saltHex: string;
};

export type ConfidentialInvoiceDraft = {
  invoiceIdHex: string;
  tokenColorHex: string;
  witness: PrivateInvoiceWitness;
};

export type InvoiceLedgerSnapshot = {
  invoiceIdHex: string;
  commitmentHex: string;
  tokenColorHex: string;
  status: InvoiceStatus;
  acceptanceNullifierHex?: string;
  paymentNullifierHex?: string;
};

export const INVOICE_FIELD_VISIBILITY = {
  invoiceCommitment: "PUBLIC",
  status: "PUBLIC",
  tokenColor: "PUBLIC",
  amountMinor: "PRIVATE",
  taxMinor: "PRIVATE",
  payerCommitment: "COMMITTED",
  supplierCoinPublicKey: "PRIVATE",
  dueAt: "SELECTIVELY_DISCLOSABLE",
  salt: "PRIVATE",
} as const satisfies Record<string, InvoiceVisibility>;

export const UINT64_MAX = (1n << 64n) - 1n;

export function assertInvoiceWitness(witness: PrivateInvoiceWitness): void {
  if (witness.amountMinor <= 0n || witness.amountMinor > UINT64_MAX) {
    throw new Error("Invoice amount must be within Uint64 range and greater than zero");
  }
  if (witness.taxMinor < 0n || witness.taxMinor > witness.amountMinor || witness.taxMinor > UINT64_MAX) {
    throw new Error("Invoice tax must be between zero and the private invoice amount");
  }
  if (witness.dueAt <= 0n || witness.dueAt > UINT64_MAX) throw new Error("Invoice due date is outside Uint64 range");
  for (const [label, value] of [
    ["payer commitment", witness.payerCommitmentHex],
    ["supplier coin public key", witness.supplierCoinPublicKeyHex],
    ["invoice salt", witness.saltHex],
  ] as const) {
    if (!/^[0-9a-f]{64}$/i.test(value)) throw new Error(`${label} must be a 32-byte hex value`);
  }
}
