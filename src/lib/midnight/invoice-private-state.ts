import { levelPrivateStateProvider } from "@midnight-ntwrk/midnight-js-level-private-state-provider";
import type { PrivateStateProvider } from "@midnight-ntwrk/midnight-js-types";
import { bytesToHex, hexToBytes32 } from "./bytes";
import { assertPrivateStoragePassword } from "./private-state";
import { assertInvoiceWitness, type PrivateInvoiceWitness } from "../invoice/types";

export const BLACKOUT_INVOICE_PRIVATE_STATE_ID = "blackoutInvoicePrivateState" as const;

export type InvoicePrivateRecord = {
  amountMinor: bigint;
  taxMinor: bigint;
  payerCommitment: Uint8Array;
  supplierCoinPublicKey: Uint8Array;
  dueAt: bigint;
  salt: Uint8Array;
};

export type BlackoutInvoicePrivateState = {
  invoiceRecords: Record<string, InvoicePrivateRecord>;
  activeInvoiceId?: string;
};

export function createInitialInvoicePrivateState(): BlackoutInvoicePrivateState {
  return { invoiceRecords: {} };
}

function normalizeInvoiceId(invoiceIdHex: string): string {
  return bytesToHex(hexToBytes32(invoiceIdHex, "invoice identifier"));
}

function recordFromWitness(witness: PrivateInvoiceWitness): InvoicePrivateRecord {
  assertInvoiceWitness(witness);
  return {
    amountMinor: witness.amountMinor,
    taxMinor: witness.taxMinor,
    payerCommitment: hexToBytes32(witness.payerCommitmentHex, "payer commitment"),
    supplierCoinPublicKey: hexToBytes32(witness.supplierCoinPublicKeyHex, "supplier coin public key"),
    dueAt: witness.dueAt,
    salt: hexToBytes32(witness.saltHex, "invoice salt"),
  };
}

export function upsertInvoiceWitness(
  state: BlackoutInvoicePrivateState,
  invoiceIdHex: string,
  witness: PrivateInvoiceWitness,
): BlackoutInvoicePrivateState {
  const key = normalizeInvoiceId(invoiceIdHex);
  const incoming = recordFromWitness(witness);
  const existing = state.invoiceRecords[key];
  if (existing) {
    const same = existing.amountMinor === incoming.amountMinor && existing.taxMinor === incoming.taxMinor &&
      existing.dueAt === incoming.dueAt && bytesToHex(existing.payerCommitment) === bytesToHex(incoming.payerCommitment) &&
      bytesToHex(existing.supplierCoinPublicKey) === bytesToHex(incoming.supplierCoinPublicKey) &&
      bytesToHex(existing.salt) === bytesToHex(incoming.salt);
    if (!same) throw new Error("Existing encrypted invoice witness cannot be overwritten with different private data");
  }
  return {
    ...state,
    invoiceRecords: { ...state.invoiceRecords, [key]: existing ?? incoming },
    activeInvoiceId: key,
  };
}

export function activateInvoiceWitness(state: BlackoutInvoicePrivateState, invoiceIdHex: string): BlackoutInvoicePrivateState {
  const key = normalizeInvoiceId(invoiceIdHex);
  if (!state.invoiceRecords[key]) throw new Error("Encrypted private state does not contain this invoice witness");
  return { ...state, activeInvoiceId: key };
}

export function getInvoicePrivateRecord(state: BlackoutInvoicePrivateState, invoiceIdHex: string): InvoicePrivateRecord {
  const key = normalizeInvoiceId(invoiceIdHex);
  const record = state.invoiceRecords[key];
  if (!record) throw new Error("Encrypted private invoice witness is unavailable");
  return record;
}

export function invoiceWitnesses() {
  return {
    getInvoiceRecord(context: { privateState: BlackoutInvoicePrivateState }) {
      const key = context.privateState.activeInvoiceId;
      const record = key ? context.privateState.invoiceRecords[key] : undefined;
      if (!record) throw new Error("Private invoice witness is not active for this circuit call");
      return [context.privateState, record] as const;
    },
  };
}

export function createEncryptedInvoicePrivateStateProvider(
  accountId: string,
  password: string,
): PrivateStateProvider<typeof BLACKOUT_INVOICE_PRIVATE_STATE_ID, BlackoutInvoicePrivateState> {
  if (!accountId.trim()) throw new Error("Wallet account identifier is required for invoice private-state isolation");
  const validatedPassword = assertPrivateStoragePassword(password);
  return levelPrivateStateProvider<typeof BLACKOUT_INVOICE_PRIVATE_STATE_ID, BlackoutInvoicePrivateState>({
    accountId,
    privateStateStoreName: "blackout-invoice-private-states",
    signingKeyStoreName: "blackout-invoice-signing-keys",
    privateStoragePasswordProvider: () => validatedPassword,
    cryptoBackend: "webcrypto",
  });
}
