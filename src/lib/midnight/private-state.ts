import { levelPrivateStateProvider } from "@midnight-ntwrk/midnight-js-level-private-state-provider";
import type { PrivateStateProvider } from "@midnight-ntwrk/midnight-js-types";
import { bytesToHex, hexToBytes32, randomBytes32 } from "./bytes";
import type { PrivateEmployeeWitness, PrivatePayRunWitness, PrivateSettlementPayment } from "./contract-client";

export const BLACKPAY_PRIVATE_STATE_ID = "blackpayPrivateState" as const;

export type BlackpayEmployeeRecord = {
  salaryMinor: bigint;
  payoutCommitment: Uint8Array;
  payoutCoinPublicKey: Uint8Array;
  salt: Uint8Array;
};

export type BlackpayPayRunRecord = {
  totalPayrollMinor: bigint;
  paymentsRoot: Uint8Array;
  salt: Uint8Array;
};

export type BlackpayFundedCoin = {
  nonce: Uint8Array;
  color: Uint8Array;
  value: bigint;
  mtIndexCandidates: bigint[];
  activeMtIndex?: bigint;
};

export type BlackpaySettlementPaymentRecord = {
  claimIdHex: string;
  payRunIdHex: string;
  employeeIdHex: string;
  amountMinor: bigint;
  payoutCoinPublicKey: Uint8Array;
  paymentSalt: Uint8Array;
  tokenColor: Uint8Array;
  fundedCoin?: BlackpayFundedCoin;
};

export type BlackpayPortalPayslipStatus = "pending" | "approved" | "funded" | "paid";

export type BlackpayPortalPayslipRecord = {
  employeeIdHex: string;
  payRunIdHex: string;
  period: number;
  grossMinor: bigint;
  netMinor: bigint;
  currencyCode: string;
  status: BlackpayPortalPayslipStatus;
  paymentTransactionId?: string;
  createdAt: number;
};

export type BlackpayPrivateState = {
  adminSecret: Uint8Array;
  employeeRecords: Record<string, BlackpayEmployeeRecord>;
  payRunRecords: Record<string, BlackpayPayRunRecord>;
  settlementPayments?: Record<string, BlackpaySettlementPaymentRecord>;
  portalPayslips?: Record<string, BlackpayPortalPayslipRecord>;
  workspaceCurrencyCode?: string;
  activeEmployeeId?: string;
  activePayRunId?: string;
  activeSettlementClaimId?: string;
};

const UINT64_MAX = (1n << 64n) - 1n;
const UINT128_MAX = (1n << 128n) - 1n;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
const STATUS_RANK: Record<BlackpayPortalPayslipStatus, number> = { pending: 0, approved: 1, funded: 2, paid: 3 };

export function createInitialBlackpayPrivateState(adminSecret = randomBytes32()): BlackpayPrivateState {
  if (adminSecret.length !== 32) throw new Error("Blackpay admin secret must be 32 bytes");
  return {
    adminSecret: new Uint8Array(adminSecret),
    employeeRecords: {},
    payRunRecords: {},
    settlementPayments: {},
    portalPayslips: {},
  };
}

function employeeRecordFromWitness(witness: PrivateEmployeeWitness): BlackpayEmployeeRecord {
  if (witness.salaryMinor <= 0n || witness.salaryMinor > UINT64_MAX) throw new Error("Private salary is outside the supported range");
  return {
    salaryMinor: witness.salaryMinor,
    payoutCommitment: hexToBytes32(witness.payoutCommitmentHex, "payout commitment"),
    payoutCoinPublicKey: hexToBytes32(witness.payoutCoinPublicKeyHex, "payout coin public key"),
    salt: hexToBytes32(witness.saltHex, "employee salt"),
  };
}

export function employeeWitnessFromRecord(record: BlackpayEmployeeRecord): PrivateEmployeeWitness {
  if (record.salaryMinor <= 0n || record.salaryMinor > UINT64_MAX) throw new Error("Encrypted employee record has an invalid salary");
  return {
    salaryMinor: record.salaryMinor,
    payoutCommitmentHex: bytesToHex(record.payoutCommitment),
    payoutCoinPublicKeyHex: bytesToHex(record.payoutCoinPublicKey),
    saltHex: bytesToHex(record.salt),
  };
}

function payRunRecordFromWitness(witness: PrivatePayRunWitness): BlackpayPayRunRecord {
  if (witness.totalPayrollMinor <= 0n || witness.totalPayrollMinor > UINT128_MAX) throw new Error("Private payroll total is outside the supported range");
  return {
    totalPayrollMinor: witness.totalPayrollMinor,
    paymentsRoot: hexToBytes32(witness.paymentsRootHex, "payments root"),
    salt: hexToBytes32(witness.saltHex, "pay-run salt"),
  };
}

export function upsertEmployeeWitness(state: BlackpayPrivateState, employeeIdHex: string, witness: PrivateEmployeeWitness): BlackpayPrivateState {
  hexToBytes32(employeeIdHex, "employee identifier");
  return {
    ...state,
    employeeRecords: { ...(state.employeeRecords ?? {}), [employeeIdHex]: employeeRecordFromWitness(witness) },
    activeEmployeeId: employeeIdHex,
  };
}

export function activateEmployeeWitness(state: BlackpayPrivateState, employeeIdHex: string): BlackpayPrivateState {
  hexToBytes32(employeeIdHex, "employee identifier");
  if (!state.employeeRecords?.[employeeIdHex]) {
    throw new Error("Encrypted private state has no witness for this employee. Import an employee access package or Blackpay backup first.");
  }
  return { ...state, activeEmployeeId: employeeIdHex };
}

export function upsertPayRunWitness(state: BlackpayPrivateState, payRunIdHex: string, witness: PrivatePayRunWitness): BlackpayPrivateState {
  hexToBytes32(payRunIdHex, "pay-run identifier");
  return {
    ...state,
    payRunRecords: { ...(state.payRunRecords ?? {}), [payRunIdHex]: payRunRecordFromWitness(witness) },
    activePayRunId: payRunIdHex,
  };
}

export function activatePayRunWitness(state: BlackpayPrivateState, payRunIdHex: string): BlackpayPrivateState {
  hexToBytes32(payRunIdHex, "pay-run identifier");
  if (!state.payRunRecords?.[payRunIdHex]) {
    throw new Error("Encrypted private state has no witness for this pay run. Import a Blackpay backup or create the pay run first.");
  }
  return { ...state, activePayRunId: payRunIdHex };
}

function settlementRecordFromInput(input: PrivateSettlementPayment & { claimIdHex: string; payRunIdHex: string; tokenColorHex: string }): BlackpaySettlementPaymentRecord {
  hexToBytes32(input.claimIdHex, "payment claim identifier");
  hexToBytes32(input.payRunIdHex, "pay-run identifier");
  hexToBytes32(input.employeeIdHex, "employee identifier");
  if (input.amountMinor <= 0n || input.amountMinor > UINT64_MAX) throw new Error("Settlement payment amount is outside the supported range");
  return {
    claimIdHex: input.claimIdHex.toLowerCase(),
    payRunIdHex: input.payRunIdHex.toLowerCase(),
    employeeIdHex: input.employeeIdHex.toLowerCase(),
    amountMinor: input.amountMinor,
    payoutCoinPublicKey: hexToBytes32(input.payoutCoinPublicKeyHex, "payment payout coin public key"),
    paymentSalt: hexToBytes32(input.paymentSaltHex, "payment salt"),
    tokenColor: hexToBytes32(input.tokenColorHex, "payment token color"),
  };
}

export function upsertSettlementPayment(
  state: BlackpayPrivateState,
  input: PrivateSettlementPayment & { claimIdHex: string; payRunIdHex: string; tokenColorHex: string },
): BlackpayPrivateState {
  const record = settlementRecordFromInput(input);
  const existing = state.settlementPayments?.[record.claimIdHex];
  if (existing) {
    if (
      existing.payRunIdHex !== record.payRunIdHex || existing.employeeIdHex !== record.employeeIdHex ||
      existing.amountMinor !== record.amountMinor || bytesToHex(existing.payoutCoinPublicKey) !== bytesToHex(record.payoutCoinPublicKey) ||
      bytesToHex(existing.paymentSalt) !== bytesToHex(record.paymentSalt) || bytesToHex(existing.tokenColor) !== bytesToHex(record.tokenColor)
    ) {
      throw new Error("Existing private settlement claim cannot be overwritten with different payment data");
    }
    return state;
  }
  return {
    ...state,
    settlementPayments: { ...(state.settlementPayments ?? {}), [record.claimIdHex]: record },
  };
}

export function attachFundedCoin(
  state: BlackpayPrivateState,
  claimIdHex: string,
  coin: { nonceHex: string; colorHex: string; value: bigint; mtIndexCandidates: bigint[] },
): BlackpayPrivateState {
  const claimId = bytesToHex(hexToBytes32(claimIdHex, "payment claim identifier"));
  const existing = state.settlementPayments?.[claimId];
  if (!existing) throw new Error("Private settlement claim is missing");
  if (coin.value !== existing.amountMinor) throw new Error("Funded coin amount does not match the private payment claim");
  const color = hexToBytes32(coin.colorHex, "funded coin color");
  if (bytesToHex(color) !== bytesToHex(existing.tokenColor)) throw new Error("Funded coin color does not match the private payment claim");
  const nonce = hexToBytes32(coin.nonceHex, "funded coin nonce");
  const candidates = [...new Set(coin.mtIndexCandidates.map((value) => BigInt(value)))];
  if (candidates.length === 0 || candidates.length > 32 || candidates.some((value) => value < 0n || value > UINT64_MAX)) {
    throw new Error("Funded coin commitment-tree candidates are invalid");
  }
  return {
    ...state,
    settlementPayments: {
      ...(state.settlementPayments ?? {}),
      [claimId]: {
        ...existing,
        fundedCoin: { nonce, color, value: coin.value, mtIndexCandidates: candidates },
      },
    },
  };
}

export function activateFundedCoinCandidate(state: BlackpayPrivateState, claimIdHex: string, mtIndex: bigint): BlackpayPrivateState {
  const claimId = bytesToHex(hexToBytes32(claimIdHex, "payment claim identifier"));
  const existing = state.settlementPayments?.[claimId];
  if (!existing?.fundedCoin) throw new Error("Funded settlement coin is missing from encrypted private state");
  if (!existing.fundedCoin.mtIndexCandidates.some((candidate) => candidate === mtIndex)) {
    throw new Error("Requested funded-coin tree index is not an allowed candidate");
  }
  return {
    ...state,
    activeSettlementClaimId: claimId,
    settlementPayments: {
      ...(state.settlementPayments ?? {}),
      [claimId]: { ...existing, fundedCoin: { ...existing.fundedCoin, activeMtIndex: mtIndex } },
    },
  };
}

export function getSettlementPayment(state: BlackpayPrivateState, payRunIdHex: string, employeeIdHex: string): BlackpaySettlementPaymentRecord {
  const run = bytesToHex(hexToBytes32(payRunIdHex, "pay-run identifier"));
  const employee = bytesToHex(hexToBytes32(employeeIdHex, "employee identifier"));
  const record = Object.values(state.settlementPayments ?? {}).find((item) => item.payRunIdHex === run && item.employeeIdHex === employee);
  if (!record) throw new Error("Private settlement payment is unavailable. Import the latest employee access package or create the pay run again.");
  return record;
}

export function listSettlementPaymentsForPayRun(state: BlackpayPrivateState, payRunIdHex: string): BlackpaySettlementPaymentRecord[] {
  const run = bytesToHex(hexToBytes32(payRunIdHex, "pay-run identifier"));
  return Object.values(state.settlementPayments ?? {}).filter((item) => item.payRunIdHex === run);
}

function normalizedCurrency(value: string, label: string): string {
  const normalized = value.trim().toUpperCase();
  if (!/^[A-Z0-9._-]{1,24}$/.test(normalized)) throw new Error(`${label} is invalid`);
  return normalized;
}

function validatedPaymentTransactionId(value?: string): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim();
  if (normalized !== value || !/^[0-9A-Za-z:_-]{16,256}$/.test(normalized)) throw new Error("Private payslip settlement transaction identifier is invalid");
  return normalized;
}

export function setPrivateWorkspaceCurrency(state: BlackpayPrivateState, currencyCode: string): BlackpayPrivateState {
  return { ...state, workspaceCurrencyCode: normalizedCurrency(currencyCode, "Private workspace currency code") };
}

function payslipKey(employeeIdHex: string, payRunIdHex: string): string {
  hexToBytes32(employeeIdHex, "employee identifier");
  hexToBytes32(payRunIdHex, "pay-run identifier");
  return `${employeeIdHex}:${payRunIdHex}`;
}

export function upsertPortalPayslip(state: BlackpayPrivateState, payslip: BlackpayPortalPayslipRecord): BlackpayPrivateState {
  if (!Number.isSafeInteger(payslip.period) || payslip.period <= 0 || payslip.period > 0xffffffff) throw new Error("Private payslip period is invalid");
  if (payslip.grossMinor <= 0n || payslip.grossMinor > UINT64_MAX || payslip.netMinor <= 0n || payslip.netMinor > UINT64_MAX || payslip.netMinor > payslip.grossMinor) {
    throw new Error("Private payslip amounts are invalid");
  }
  if (!Object.prototype.hasOwnProperty.call(STATUS_RANK, payslip.status)) throw new Error("Private payslip status is invalid");
  if (!Number.isSafeInteger(payslip.createdAt) || payslip.createdAt <= 0 || payslip.createdAt > Date.now() + MAX_CLOCK_SKEW_MS) throw new Error("Private payslip creation time is invalid");
  const currencyCode = normalizedCurrency(payslip.currencyCode, "Private payslip currency");
  const paymentTransactionId = validatedPaymentTransactionId(payslip.paymentTransactionId);
  const key = payslipKey(payslip.employeeIdHex, payslip.payRunIdHex);
  const existing = state.portalPayslips?.[key];
  if (existing && (existing.period !== payslip.period || existing.grossMinor !== payslip.grossMinor || existing.netMinor !== payslip.netMinor || existing.currencyCode !== currencyCode)) {
    throw new Error("Existing encrypted payslip details cannot be overwritten for the same employee and pay run");
  }
  const status = existing && STATUS_RANK[existing.status] > STATUS_RANK[payslip.status] ? existing.status : payslip.status;
  const finalTransactionId = existing?.paymentTransactionId ?? paymentTransactionId;
  const record: BlackpayPortalPayslipRecord = {
    ...payslip,
    currencyCode,
    status,
    createdAt: existing ? Math.min(existing.createdAt, payslip.createdAt) : payslip.createdAt,
    ...(finalTransactionId ? { paymentTransactionId: finalTransactionId } : {}),
  };
  return { ...state, portalPayslips: { ...(state.portalPayslips ?? {}), [key]: record } };
}

export function updatePortalPayRunStatus(state: BlackpayPrivateState, payRunIdHex: string, status: BlackpayPortalPayslipStatus, paymentTransactionId?: string): BlackpayPrivateState {
  hexToBytes32(payRunIdHex, "pay-run identifier");
  if (!Object.prototype.hasOwnProperty.call(STATUS_RANK, status)) throw new Error("Private payslip status is invalid");
  const validatedTx = validatedPaymentTransactionId(paymentTransactionId);
  const next: Record<string, BlackpayPortalPayslipRecord> = {};
  for (const [key, payslip] of Object.entries(state.portalPayslips ?? {})) {
    if (payslip.payRunIdHex !== payRunIdHex) { next[key] = payslip; continue; }
    const nextStatus = STATUS_RANK[status] >= STATUS_RANK[payslip.status] ? status : payslip.status;
    const finalTransactionId = payslip.paymentTransactionId ?? validatedTx;
    next[key] = { ...payslip, status: nextStatus, ...(finalTransactionId ? { paymentTransactionId: finalTransactionId } : {}) };
  }
  return { ...state, portalPayslips: next };
}

export function listPortalPayslips(state: BlackpayPrivateState, employeeIdHex: string): BlackpayPortalPayslipRecord[] {
  hexToBytes32(employeeIdHex, "employee identifier");
  return Object.values(state.portalPayslips ?? {})
    .filter((payslip) => payslip.employeeIdHex === employeeIdHex)
    .sort((a, b) => b.period - a.period || b.createdAt - a.createdAt)
    .map((payslip) => ({ ...payslip }));
}

export function blackpayWitnesses() {
  return {
    getAdminSecret(context: { privateState: BlackpayPrivateState }) {
      return [context.privateState, context.privateState.adminSecret] as const;
    },
    getEmployeeRecord(context: { privateState: BlackpayPrivateState }) {
      const key = context.privateState.activeEmployeeId;
      const record = key ? context.privateState.employeeRecords?.[key] : undefined;
      if (!record) throw new Error("Private employee witness is not loaded for this circuit call");
      return [context.privateState, record] as const;
    },
    getPayRunRecord(context: { privateState: BlackpayPrivateState }) {
      const key = context.privateState.activePayRunId;
      const record = key ? context.privateState.payRunRecords?.[key] : undefined;
      if (!record) throw new Error("Private pay-run witness is not loaded for this circuit call");
      return [context.privateState, record] as const;
    },
    getFundedCoin(context: { privateState: BlackpayPrivateState }) {
      const claimId = context.privateState.activeSettlementClaimId;
      const record = claimId ? context.privateState.settlementPayments?.[claimId] : undefined;
      const funded = record?.fundedCoin;
      if (!funded || funded.activeMtIndex === undefined) throw new Error("A funded settlement coin candidate is not active for this claim");
      return [context.privateState, {
        nonce: new Uint8Array(funded.nonce),
        color: new Uint8Array(funded.color),
        value: funded.value,
        mt_index: funded.activeMtIndex,
      }] as const;
    },
  };
}

export function assertPrivateStoragePassword(password: string): string {
  if (password.length < 16) throw new Error("Private-state password must be at least 16 characters");
  if (password.length > 256) throw new Error("Private-state password is too long");
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((pattern) => pattern.test(password)).length;
  if (classes < 3) throw new Error("Private-state password must use at least three character types");
  if (/(.)\1\1\1/.test(password)) throw new Error("Private-state password cannot contain four repeated characters");
  if (/0123|1234|2345|3456|4567|5678|6789|abcd|bcde|cdef/i.test(password)) throw new Error("Private-state password contains an unsafe sequential pattern");
  return password;
}

export function createEncryptedPrivateStateProvider(accountId: string, password: string): PrivateStateProvider<typeof BLACKPAY_PRIVATE_STATE_ID, BlackpayPrivateState> {
  if (!accountId.trim()) throw new Error("Wallet account identifier is required for private-state isolation");
  const validatedPassword = assertPrivateStoragePassword(password);
  return levelPrivateStateProvider<typeof BLACKPAY_PRIVATE_STATE_ID, BlackpayPrivateState>({
    accountId,
    privateStateStoreName: "blackpay-private-states",
    signingKeyStoreName: "blackpay-signing-keys",
    privateStoragePasswordProvider: () => validatedPassword,
    cryptoBackend: "webcrypto",
  });
}
