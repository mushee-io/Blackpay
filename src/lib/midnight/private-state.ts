import { levelPrivateStateProvider } from "@midnight-ntwrk/midnight-js-level-private-state-provider";
import type { PrivateStateProvider } from "@midnight-ntwrk/midnight-js-types";
import { bytesToHex, hexToBytes32, randomBytes32 } from "./bytes";
import type { PrivateEmployeeWitness, PrivatePayRunWitness } from "./contract-client";

export const BLACKPAY_PRIVATE_STATE_ID = "blackpayPrivateState" as const;

export type BlackpayEmployeeRecord = {
  salaryMinor: bigint;
  payoutCommitment: Uint8Array;
  salt: Uint8Array;
};

export type BlackpayPayRunRecord = {
  totalPayrollMinor: bigint;
  paymentsRoot: Uint8Array;
  salt: Uint8Array;
};

export type BlackpayPortalPayslipStatus = "pending" | "approved" | "paid";

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
  portalPayslips?: Record<string, BlackpayPortalPayslipRecord>;
  workspaceCurrencyCode?: string;
  activeEmployeeId?: string;
  activePayRunId?: string;
};

const UINT64_MAX = (1n << 64n) - 1n;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
const STATUS_RANK: Record<BlackpayPortalPayslipStatus, number> = { pending: 0, approved: 1, paid: 2 };

export function createInitialBlackpayPrivateState(adminSecret = randomBytes32()): BlackpayPrivateState {
  if (adminSecret.length !== 32) throw new Error("Blackpay admin secret must be 32 bytes");
  return {
    adminSecret: new Uint8Array(adminSecret),
    employeeRecords: {},
    payRunRecords: {},
    portalPayslips: {},
  };
}

function employeeRecordFromWitness(witness: PrivateEmployeeWitness): BlackpayEmployeeRecord {
  if (witness.salaryMinor <= 0n || witness.salaryMinor > UINT64_MAX) throw new Error("Private salary is outside the supported range");
  return {
    salaryMinor: witness.salaryMinor,
    payoutCommitment: hexToBytes32(witness.payoutCommitmentHex, "payout commitment"),
    salt: hexToBytes32(witness.saltHex, "employee salt"),
  };
}

export function employeeWitnessFromRecord(record: BlackpayEmployeeRecord): PrivateEmployeeWitness {
  if (record.salaryMinor <= 0n || record.salaryMinor > UINT64_MAX) throw new Error("Encrypted employee record has an invalid salary");
  return {
    salaryMinor: record.salaryMinor,
    payoutCommitmentHex: bytesToHex(record.payoutCommitment),
    saltHex: bytesToHex(record.salt),
  };
}

function payRunRecordFromWitness(witness: PrivatePayRunWitness): BlackpayPayRunRecord {
  if (witness.totalPayrollMinor <= 0n) throw new Error("Private payroll total must be greater than zero");
  return {
    totalPayrollMinor: witness.totalPayrollMinor,
    paymentsRoot: hexToBytes32(witness.paymentsRootHex, "payments root"),
    salt: hexToBytes32(witness.saltHex, "pay-run salt"),
  };
}

export function upsertEmployeeWitness(
  state: BlackpayPrivateState,
  employeeIdHex: string,
  witness: PrivateEmployeeWitness,
): BlackpayPrivateState {
  hexToBytes32(employeeIdHex, "employee identifier");
  return {
    ...state,
    employeeRecords: {
      ...(state.employeeRecords ?? {}),
      [employeeIdHex]: employeeRecordFromWitness(witness),
    },
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

export function upsertPayRunWitness(
  state: BlackpayPrivateState,
  payRunIdHex: string,
  witness: PrivatePayRunWitness,
): BlackpayPrivateState {
  hexToBytes32(payRunIdHex, "pay-run identifier");
  return {
    ...state,
    payRunRecords: {
      ...(state.payRunRecords ?? {}),
      [payRunIdHex]: payRunRecordFromWitness(witness),
    },
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

function normalizedCurrency(value: string, label: string): string {
  const normalized = value.trim().toUpperCase();
  if (!/^[A-Z0-9._-]{1,24}$/.test(normalized)) throw new Error(`${label} is invalid`);
  return normalized;
}

function validatedPaymentTransactionId(value?: string): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim();
  if (normalized !== value || !/^[0-9A-Za-z:_-]{16,256}$/.test(normalized)) {
    throw new Error("Private payslip settlement transaction identifier is invalid");
  }
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

export function upsertPortalPayslip(
  state: BlackpayPrivateState,
  payslip: BlackpayPortalPayslipRecord,
): BlackpayPrivateState {
  if (!Number.isSafeInteger(payslip.period) || payslip.period <= 0 || payslip.period > 0xffffffff) {
    throw new Error("Private payslip period is invalid");
  }
  if (
    payslip.grossMinor <= 0n || payslip.grossMinor > UINT64_MAX ||
    payslip.netMinor <= 0n || payslip.netMinor > UINT64_MAX ||
    payslip.netMinor > payslip.grossMinor
  ) {
    throw new Error("Private payslip amounts are invalid");
  }
  if (!Object.prototype.hasOwnProperty.call(STATUS_RANK, payslip.status)) throw new Error("Private payslip status is invalid");
  if (!Number.isSafeInteger(payslip.createdAt) || payslip.createdAt <= 0 || payslip.createdAt > Date.now() + MAX_CLOCK_SKEW_MS) {
    throw new Error("Private payslip creation time is invalid");
  }
  const currencyCode = normalizedCurrency(payslip.currencyCode, "Private payslip currency");
  const paymentTransactionId = validatedPaymentTransactionId(payslip.paymentTransactionId);
  const key = payslipKey(payslip.employeeIdHex, payslip.payRunIdHex);
  const existing = state.portalPayslips?.[key];

  if (existing) {
    if (
      existing.period !== payslip.period ||
      existing.grossMinor !== payslip.grossMinor ||
      existing.netMinor !== payslip.netMinor ||
      existing.currencyCode !== currencyCode
    ) {
      throw new Error("Existing encrypted payslip details cannot be overwritten for the same employee and pay run");
    }
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

  return {
    ...state,
    portalPayslips: {
      ...(state.portalPayslips ?? {}),
      [key]: record,
    },
  };
}

export function updatePortalPayRunStatus(
  state: BlackpayPrivateState,
  payRunIdHex: string,
  status: BlackpayPortalPayslipStatus,
  paymentTransactionId?: string,
): BlackpayPrivateState {
  hexToBytes32(payRunIdHex, "pay-run identifier");
  if (!Object.prototype.hasOwnProperty.call(STATUS_RANK, status)) throw new Error("Private payslip status is invalid");
  const validatedTx = validatedPaymentTransactionId(paymentTransactionId);
  const next: Record<string, BlackpayPortalPayslipRecord> = {};
  for (const [key, payslip] of Object.entries(state.portalPayslips ?? {})) {
    if (payslip.payRunIdHex !== payRunIdHex) {
      next[key] = payslip;
      continue;
    }
    const nextStatus = STATUS_RANK[status] >= STATUS_RANK[payslip.status] ? status : payslip.status;
    const finalTransactionId = payslip.paymentTransactionId ?? validatedTx;
    next[key] = {
      ...payslip,
      status: nextStatus,
      ...(finalTransactionId ? { paymentTransactionId: finalTransactionId } : {}),
    };
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
  };
}

export function assertPrivateStoragePassword(password: string): string {
  if (password.length < 16) throw new Error("Private-state password must be at least 16 characters");
  if (password.length > 256) throw new Error("Private-state password is too long");
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((pattern) => pattern.test(password)).length;
  if (classes < 3) throw new Error("Private-state password must use at least three character types");
  if (/(.)\1\1\1/.test(password)) throw new Error("Private-state password cannot contain four repeated characters");
  if (/0123|1234|2345|3456|4567|5678|6789|abcd|bcde|cdef/i.test(password)) {
    throw new Error("Private-state password contains an unsafe sequential pattern");
  }
  return password;
}

export function createEncryptedPrivateStateProvider(
  accountId: string,
  password: string,
): PrivateStateProvider<typeof BLACKPAY_PRIVATE_STATE_ID, BlackpayPrivateState> {
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
