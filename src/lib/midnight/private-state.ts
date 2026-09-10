import { levelPrivateStateProvider } from "@midnight-ntwrk/midnight-js-level-private-state-provider";
import type { PrivateStateProvider } from "@midnight-ntwrk/midnight-js-types";
import { hexToBytes32, randomBytes32 } from "./bytes";
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

export type BlackpayPrivateState = {
  adminSecret: Uint8Array;
  employeeRecords: Record<string, BlackpayEmployeeRecord>;
  payRunRecords: Record<string, BlackpayPayRunRecord>;
  activeEmployeeId?: string;
  activePayRunId?: string;
};

export function createInitialBlackpayPrivateState(adminSecret = randomBytes32()): BlackpayPrivateState {
  if (adminSecret.length !== 32) throw new Error("Blackpay admin secret must be 32 bytes");
  return {
    adminSecret: new Uint8Array(adminSecret),
    employeeRecords: {},
    payRunRecords: {},
  };
}

function employeeRecordFromWitness(witness: PrivateEmployeeWitness): BlackpayEmployeeRecord {
  if (witness.salaryMinor <= 0n) throw new Error("Private salary must be greater than zero");
  return {
    salaryMinor: witness.salaryMinor,
    payoutCommitment: hexToBytes32(witness.payoutCommitmentHex, "payout commitment"),
    salt: hexToBytes32(witness.saltHex, "employee salt"),
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
      ...state.employeeRecords,
      [employeeIdHex]: employeeRecordFromWitness(witness),
    },
    activeEmployeeId: employeeIdHex,
  };
}

export function activateEmployeeWitness(state: BlackpayPrivateState, employeeIdHex: string): BlackpayPrivateState {
  hexToBytes32(employeeIdHex, "employee identifier");
  if (!state.employeeRecords[employeeIdHex]) {
    throw new Error("Encrypted private state has no witness for this employee. Import a Blackpay backup or register the employee first.");
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
      ...state.payRunRecords,
      [payRunIdHex]: payRunRecordFromWitness(witness),
    },
    activePayRunId: payRunIdHex,
  };
}

export function activatePayRunWitness(state: BlackpayPrivateState, payRunIdHex: string): BlackpayPrivateState {
  hexToBytes32(payRunIdHex, "pay-run identifier");
  if (!state.payRunRecords[payRunIdHex]) {
    throw new Error("Encrypted private state has no witness for this pay run. Import a Blackpay backup or create the pay run first.");
  }
  return { ...state, activePayRunId: payRunIdHex };
}

export function blackpayWitnesses() {
  return {
    getAdminSecret(context: { privateState: BlackpayPrivateState }) {
      return [context.privateState, context.privateState.adminSecret] as const;
    },
    getEmployeeRecord(context: { privateState: BlackpayPrivateState }) {
      const key = context.privateState.activeEmployeeId;
      const record = key ? context.privateState.employeeRecords[key] : undefined;
      if (!record) throw new Error("Private employee witness is not loaded for this circuit call");
      return [context.privateState, record] as const;
    },
    getPayRunRecord(context: { privateState: BlackpayPrivateState }) {
      const key = context.privateState.activePayRunId;
      const record = key ? context.privateState.payRunRecords[key] : undefined;
      if (!record) throw new Error("Private pay-run witness is not loaded for this circuit call");
      return [context.privateState, record] as const;
    },
  };
}

export function assertPrivateStoragePassword(password: string): string {
  if (password.length < 16) throw new Error("Private-state password must be at least 16 characters");
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
