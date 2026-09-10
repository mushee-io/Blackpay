import type { EmployerWorkspaceInput, PrivateEmployeeInput, PrivatePayRunInput } from "./types";

const HEX_32 = /^[0-9a-fA-F]{64}$/;

export function assertWorkspaceInput(input: EmployerWorkspaceInput): void {
  if (!input.companyName.trim()) throw new Error("Company name is required");
  if (!/^[A-Z0-9]{2,8}$/.test(input.currencyCode.trim().toUpperCase())) {
    throw new Error("Currency code must be 2-8 uppercase letters/numbers");
  }
}

export function assertPrivateEmployeeInput(input: PrivateEmployeeInput): void {
  if (!input.employeeId.trim()) throw new Error("Employee ID is required");
  if (input.salaryMinor <= 0n) throw new Error("Salary must be greater than zero");
  if (!input.shieldedRecipient.trim()) throw new Error("Shielded recipient is required");
  if (!HEX_32.test(input.saltHex)) throw new Error("Employee salt must be exactly 32 bytes of hex");
}

export function assertPrivatePayRunInput(input: PrivatePayRunInput): void {
  if (!input.payRunId.trim()) throw new Error("Pay run ID is required");
  if (!Number.isSafeInteger(input.period) || input.period <= 0) throw new Error("Pay period must be a positive integer");
  if (input.payments.length === 0) throw new Error("A pay run must include at least one payment");
  if (!HEX_32.test(input.saltHex)) throw new Error("Pay run salt must be exactly 32 bytes of hex");

  const ids = new Set<string>();
  for (const payment of input.payments) {
    if (!payment.employeeId.trim()) throw new Error("Every payroll payment must include an employee ID");
    if (ids.has(payment.employeeId)) throw new Error(`Duplicate employee in pay run: ${payment.employeeId}`);
    ids.add(payment.employeeId);
    if (payment.salaryMinor <= 0n) throw new Error("Every payroll payment amount must be greater than zero");
    if (!payment.shieldedRecipient.trim()) throw new Error("Every payroll payment requires a shielded recipient");
  }
}

export function newPrivateSaltHex(): string {
  if (typeof crypto === "undefined" || !crypto.getRandomValues) {
    throw new Error("Secure browser randomness is unavailable");
  }
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
