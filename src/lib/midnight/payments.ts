import type { ConnectedAPI, DesiredOutput, TokenType } from "@midnight-ntwrk/dapp-connector-api";
import * as ledger from "@midnight-ntwrk/midnight-js-protocol/ledger";
import type { PrivatePayrollPayment } from "../payroll/types";
import { transactionHexToBytes } from "./bytes";

function requirePositivePayment(payment: PrivatePayrollPayment): void {
  if (payment.salaryMinor <= 0n) throw new Error("Payroll payment must be greater than zero");
  if (!payment.shieldedRecipient.trim()) throw new Error("Payroll payment requires a shielded recipient");
}

function transactionIdFromSerialized(serializedHex: string): string {
  const finalized = ledger.Transaction.deserialize(
    "signature",
    "proof",
    "binding",
    transactionHexToBytes(serializedHex),
  ) as ledger.FinalizedTransaction;
  const [transactionId] = finalized.identifiers();
  if (!transactionId) throw new Error("Unable to derive a Midnight transaction identifier before submission");
  return transactionId;
}

export async function submitShieldedPayroll(params: {
  wallet: ConnectedAPI;
  tokenType: string;
  payments: PrivatePayrollPayment[];
}): Promise<{ transactionId: string }> {
  const { wallet, tokenType, payments } = params;
  if (!tokenType.trim()) throw new Error("A real Midnight payroll token type must be configured");
  if (payments.length === 0) throw new Error("Payroll contains no payments");

  for (const payment of payments) requirePositivePayment(payment);

  const outputs: DesiredOutput[] = payments.map((payment) => ({
    kind: "shielded",
    type: tokenType.trim() as TokenType,
    value: payment.salaryMinor,
    recipient: payment.shieldedRecipient.trim(),
  }));

  const transfer = await wallet.makeTransfer(outputs, { payFees: true });
  if (!transfer.tx?.trim()) throw new Error("Midnight wallet did not return a serialized payroll transaction");

  const transactionId = transactionIdFromSerialized(transfer.tx);
  await wallet.submitTransaction(transfer.tx);
  return { transactionId };
}
