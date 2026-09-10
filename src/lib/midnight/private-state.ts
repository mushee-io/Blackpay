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
  employeeRecord?: BlackpayEmployeeRecord;
  payRunRecord?: BlackpayPayRunRecord;
};

export function createInitialBlackpayPrivateState(adminSecret = randomBytes32()): BlackpayPrivateState {
  if (adminSecret.length !== 32) throw new Error("Blackpay admin secret must be 32 bytes");
  return { adminSecret: new Uint8Array(adminSecret) };
}

export function withEmployeeWitness(
  state: BlackpayPrivateState,
  witness: PrivateEmployeeWitness,
): BlackpayPrivateState {
  return {
    ...state,
    employeeRecord: {
      salaryMinor: witness.salaryMinor,
      payoutCommitment: hexToBytes32(witness.payoutCommitmentHex, "payout commitment"),
      salt: hexToBytes32(witness.saltHex, "employee salt"),
    },
  };
}

export function withPayRunWitness(
  state: BlackpayPrivateState,
  witness: PrivatePayRunWitness,
): BlackpayPrivateState {
  return {
    ...state,
    payRunRecord: {
      totalPayrollMinor: witness.totalPayrollMinor,
      paymentsRoot: hexToBytes32(witness.paymentsRootHex, "payments root"),
      salt: hexToBytes32(witness.saltHex, "pay-run salt"),
    },
  };
}

export function blackpayWitnesses() {
  return {
    getAdminSecret(context: { privateState: BlackpayPrivateState }) {
      return [context.privateState, context.privateState.adminSecret] as const;
    },
    getEmployeeRecord(context: { privateState: BlackpayPrivateState }) {
      const record = context.privateState.employeeRecord;
      if (!record) throw new Error("Private employee witness is not loaded for this circuit call");
      return [context.privateState, record] as const;
    },
    getPayRunRecord(context: { privateState: BlackpayPrivateState }) {
      const record = context.privateState.payRunRecord;
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
