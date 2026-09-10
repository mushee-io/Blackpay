import type { ConnectedMidnightWallet } from "./wallet";
import type { PrivatePayrollPayment } from "../payroll/types";

function requirePositivePayment(payment: PrivatePayrollPayment): void {
  if (payment.salaryMinor <= 0n) throw new Error("Payroll payment must be greater than zero");
  if (!payment.shieldedRecipient.trim()) throw new Error("Payroll payment requires a shielded recipient");
}

function extractTransactionId(result: unknown): string {
  if (typeof result === "string" && result.trim()) return result;
  if (result && typeof result === "object") {
    const record = result as Record<string, unknown>;
    for (const key of ["txId", "transactionId", "id", "hash"]) {
      const value = record[key];
      if (typeof value === "string" && value.trim()) return value;
    }
  }
  throw new Error("Midnight wallet submitted the payroll transaction but returned no transaction identifier");
}

export async function submitShieldedPayroll(params: {
  wallet: ConnectedMidnightWallet;
  tokenType: string;
  payments: PrivatePayrollPayment[];
}): Promise<{ transactionId: string }> {
  const { wallet, tokenType, payments } = params;
  if (!tokenType.trim()) throw new Error("A real Midnight payroll token type must be configured");
  if (payments.length === 0) throw new Error("Payroll contains no payments");

  for (const payment of payments) requirePositivePayment(payment);

  const outputs = payments.map((payment) => ({
    kind: "shielded" as const,
    tokenType,
    value: payment.salaryMinor,
    recipient: payment.shieldedRecipient.trim(),
  }));

  const transaction = await wallet.makeTransfer(outputs);
  if (!transaction) throw new Error("Midnight wallet did not create a payroll transaction");

  const submitted = await wallet.submitTransaction(transaction);
  return { transactionId: extractTransactionId(submitted) };
}
