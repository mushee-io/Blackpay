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

export type InvoiceFundedCoinRecord = {
  nonce: Uint8Array;
  color: Uint8Array;
  value: bigint;
  mtIndexCandidates: bigint[];
  activeMtIndex?: bigint;
};

export type BlackoutInvoicePrivateState = {
  invoiceRecords: Record<string, InvoicePrivateRecord>;
  payerAuthoritySecrets: Record<string, Uint8Array>;
  fundedCoins: Record<string, InvoiceFundedCoinRecord>;
  activeInvoiceId?: string;
  activeFundedInvoiceId?: string;
};

export function createInitialInvoicePrivateState(): BlackoutInvoicePrivateState {
  return { invoiceRecords: {}, payerAuthoritySecrets: {}, fundedCoins: {} };
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

export function upsertPayerAuthoritySecret(
  state: BlackoutInvoicePrivateState,
  invoiceIdHex: string,
  secretHex: string,
): BlackoutInvoicePrivateState {
  const key = normalizeInvoiceId(invoiceIdHex);
  const secret = hexToBytes32(secretHex, "payer authority secret");
  const existing = state.payerAuthoritySecrets[key];
  if (existing && bytesToHex(existing) !== bytesToHex(secret)) {
    throw new Error("Existing payer authority secret cannot be replaced for this invoice");
  }
  return {
    ...state,
    payerAuthoritySecrets: { ...state.payerAuthoritySecrets, [key]: existing ?? secret },
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

export function attachInvoiceFundedCoin(
  state: BlackoutInvoicePrivateState,
  invoiceIdHex: string,
  coin: { nonceHex: string; colorHex: string; value: bigint; mtIndexCandidates: bigint[] },
): BlackoutInvoicePrivateState {
  const key = normalizeInvoiceId(invoiceIdHex);
  const invoice = state.invoiceRecords[key];
  if (!invoice) throw new Error("Private invoice witness is required before storing funded state");
  if (coin.value !== invoice.amountMinor) throw new Error("Funded value does not match the private invoice amount");
  const candidates = [...new Set(coin.mtIndexCandidates.map((value) => BigInt(value)))];
  if (candidates.length === 0 || candidates.length > 32 || candidates.some((value) => value < 0n || value > ((1n << 64n) - 1n))) {
    throw new Error("Funded commitment-tree candidates are invalid");
  }
  return {
    ...state,
    fundedCoins: {
      ...state.fundedCoins,
      [key]: {
        nonce: hexToBytes32(coin.nonceHex, "funded coin nonce"),
        color: hexToBytes32(coin.colorHex, "funded coin color"),
        value: coin.value,
        mtIndexCandidates: candidates,
      },
    },
  };
}

export function getInvoiceFundedCoin(state: BlackoutInvoicePrivateState, invoiceIdHex: string): InvoiceFundedCoinRecord {
  const key = normalizeInvoiceId(invoiceIdHex);
  const funded = state.fundedCoins[key];
  if (!funded) throw new Error("Invoice is not funded in encrypted private state");
  return funded;
}

export function activateInvoiceFundedCoin(
  state: BlackoutInvoicePrivateState,
  invoiceIdHex: string,
  mtIndex: bigint,
): BlackoutInvoicePrivateState {
  const key = normalizeInvoiceId(invoiceIdHex);
  const funded = state.fundedCoins[key];
  if (!funded) throw new Error("Invoice funded state is missing");
  if (!funded.mtIndexCandidates.some((candidate) => candidate === mtIndex)) throw new Error("Funded tree index is not an allowed candidate");
  return {
    ...state,
    activeFundedInvoiceId: key,
    fundedCoins: { ...state.fundedCoins, [key]: { ...funded, activeMtIndex: mtIndex } },
  };
}

export function invoiceWitnesses() {
  return {
    getInvoiceRecord(context: { privateState: BlackoutInvoicePrivateState }) {
      const key = context.privateState.activeInvoiceId;
      const record = key ? context.privateState.invoiceRecords[key] : undefined;
      if (!record) throw new Error("Private invoice witness is not active for this circuit call");
      return [context.privateState, record] as const;
    },
    getPayerSecret(context: { privateState: BlackoutInvoicePrivateState }) {
      const key = context.privateState.activeInvoiceId;
      const secret = key ? context.privateState.payerAuthoritySecrets[key] : undefined;
      if (!secret) throw new Error("Private payer authority is not active for this invoice");
      return [context.privateState, new Uint8Array(secret)] as const;
    },
    getInvoiceFundedCoin(context: { privateState: BlackoutInvoicePrivateState }) {
      const key = context.privateState.activeFundedInvoiceId;
      const funded = key ? context.privateState.fundedCoins[key] : undefined;
      if (!funded || funded.activeMtIndex === undefined) throw new Error("A funded invoice coin candidate is not active");
      return [context.privateState, {
        nonce: new Uint8Array(funded.nonce),
        color: new Uint8Array(funded.color),
        value: funded.value,
        mt_index: funded.activeMtIndex,
      }] as const;
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
