import type { PrivateEmployeeWitness, PrivatePayRunWitness } from "../midnight/contract-client";

const employeeWitnesses = new Map<string, PrivateEmployeeWitness>();
const payRunWitnesses = new Map<string, PrivatePayRunWitness>();

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
}

export function putPayRunWitness(payRunIdHex: string, witness: PrivatePayRunWitness): void {
  payRunWitnesses.set(payRunIdHex, { ...witness });
}

export function getPayRunWitness(payRunIdHex: string): PrivatePayRunWitness {
  const witness = payRunWitnesses.get(payRunIdHex);
  if (!witness) throw new Error("Private pay-run witness is unavailable in this session");
  return { ...witness };
}

export function clearPrivatePayrollSession(): void {
  employeeWitnesses.clear();
  payRunWitnesses.clear();
}
