import type { PrivateEmployeeInput, PrivatePayRunInput } from "./types";
import { assertPrivateEmployeeInput, assertPrivatePayRunInput } from "./validation";

const encoder = new TextEncoder();

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return bytesToHex(new Uint8Array(digest));
}

export async function payoutCommitment(shieldedRecipient: string): Promise<string> {
  if (!shieldedRecipient.trim()) throw new Error("Shielded recipient is required");
  return sha256Hex(`blackpay:payout:v1:${shieldedRecipient.trim()}`);
}

export async function employeeOffchainCommitment(input: PrivateEmployeeInput): Promise<string> {
  assertPrivateEmployeeInput(input);
  const payout = await payoutCommitment(input.shieldedRecipient);
  return sha256Hex(
    ["blackpay:employee:v1", input.employeeId, input.salaryMinor.toString(), payout, input.saltHex].join(":"),
  );
}

export async function paymentsRoot(input: PrivatePayRunInput): Promise<string> {
  assertPrivatePayRunInput(input);
  const rows = await Promise.all(
    input.payments
      .slice()
      .sort((a, b) => a.employeeId.localeCompare(b.employeeId))
      .map(async (payment) => {
        const payout = await payoutCommitment(payment.shieldedRecipient);
        return [payment.employeeId, payment.salaryMinor.toString(), payout].join(":");
      }),
  );
  return sha256Hex(["blackpay:payments:v1", ...rows].join("|"));
}

export function payrollTotal(input: PrivatePayRunInput): bigint {
  assertPrivatePayRunInput(input);
  return input.payments.reduce((total, payment) => total + payment.salaryMinor, 0n);
}

export async function payRunOffchainCommitment(input: PrivatePayRunInput): Promise<string> {
  const root = await paymentsRoot(input);
  return sha256Hex(
    ["blackpay:payrun:v1", input.payRunId, payrollTotal(input).toString(), root, input.saltHex].join(":"),
  );
}

export async function transactionCommitment(transactionId: string): Promise<string> {
  if (!transactionId.trim()) throw new Error("Transaction ID is required");
  return sha256Hex(`blackpay:transaction:v1:${transactionId.trim()}`);
}
