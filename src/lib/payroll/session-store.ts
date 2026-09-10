import type { PrivateEmployeeWitness, PrivatePayRunWitness } from "../midnight/contract-client";
import type { PrivatePayslip } from "./types";

const employeeWitnesses = new Map<string, PrivateEmployeeWitness>();
const payRunWitnesses = new Map<string, PrivatePayRunWitness>();
const payslips = new Map<string, PrivatePayslip[]>();

export function putEmployeeWitness(employeeIdHex: string, witness: PrivateEmployeeWitness): void {
  employeeWitnesses.set(employeeIdHex, { ...witness });
}

export function getEmployeeWitness(employeeIdHex: string): PrivateEmployeeWitness {
  const witness = employeeWitnesses.get(employeeIdHex);
  if (!witness) {
    throw new Error("Private employee witness is unavailable in this session");
  }
  return { ...witness };
}

export function deleteEmployeeWitness(employeeIdHex: string): void {
  employeeWitnesses.delete(employeeIdHex);
  payslips.delete(employeeIdHex);
}

export function putPayRunWitness(payRunIdHex: string, witness: PrivatePayRunWitness): void {
  payRunWitnesses.set(payRunIdHex, { ...witness });
}

export function getPayRunWitness(payRunIdHex: string): PrivatePayRunWitness {
  const witness = payRunWitnesses.get(payRunIdHex);
  if (!witness) throw new Error("Private pay-run witness is unavailable in this session");
  return { ...witness };
}

export function putPrivatePayslip(payslip: PrivatePayslip): void {
  const current = payslips.get(payslip.employeeIdHex) ?? [];
  const withoutDuplicate = current.filter(
    (item) => !(item.payRunIdHex === payslip.payRunIdHex && item.paymentTransactionId === payslip.paymentTransactionId),
  );
  payslips.set(payslip.employeeIdHex, [{ ...payslip }, ...withoutDuplicate]);
}

export function listPrivatePayslips(employeeIdHex: string): PrivatePayslip[] {
  return (payslips.get(employeeIdHex) ?? []).map((item) => ({ ...item }));
}

export function markPayRunPayslipsFinalized(payRunIdHex: string): void {
  for (const [employeeIdHex, items] of payslips.entries()) {
    payslips.set(
      employeeIdHex,
      items.map((item) => (item.payRunIdHex === payRunIdHex ? { ...item, status: "finalized" } : item)),
    );
  }
}

export function clearPrivatePayrollSession(): void {
  employeeWitnesses.clear();
  payRunWitnesses.clear();
  payslips.clear();
}
