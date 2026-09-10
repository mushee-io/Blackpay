import type { PayrollFrequency } from "../payroll/types";

export type PrivateEmployeeWitness = {
  salaryMinor: bigint;
  payoutCommitmentHex: string;
  saltHex: string;
};

export type PrivatePayRunWitness = {
  totalPayrollMinor: bigint;
  paymentsRootHex: string;
  saltHex: string;
};

export interface PayrollContractGateway {
  createWorkspace(input: {
    workspaceIdHex: string;
    currencyIdHex: string;
    frequency: PayrollFrequency;
  }): Promise<{ transactionId: string }>;

  addEmployee(input: {
    employeeIdHex: string;
    witness: PrivateEmployeeWitness;
  }): Promise<{ transactionId: string }>;

  updateEmployee(input: {
    employeeIdHex: string;
    witness: PrivateEmployeeWitness;
  }): Promise<{ transactionId: string }>;

  removeEmployee(employeeIdHex: string): Promise<{ transactionId: string }>;

  createPayRun(input: {
    payRunIdHex: string;
    period: number;
    employeeCount: number;
    witness: PrivatePayRunWitness;
  }): Promise<{ transactionId: string }>;

  approvePayRun(payRunIdHex: string): Promise<{ transactionId: string }>;

  finalizePayRun(input: {
    payRunIdHex: string;
    transactionCommitmentHex: string;
  }): Promise<{ transactionId: string }>;

  proveIncomeAtLeast(input: {
    employeeIdHex: string;
    thresholdMinor: bigint;
    nonceHex: string;
    witness: PrivateEmployeeWitness;
  }): Promise<{ transactionId: string; proofIdHex: string }>;

  createIncomeDisclosure(input: {
    employeeIdHex: string;
    thresholdMinor: bigint;
    verifierIdHex: string;
    expiresAt: bigint;
    nonceHex: string;
    witness: PrivateEmployeeWitness;
  }): Promise<{ transactionId: string; disclosureIdHex: string }>;

  createEmploymentDisclosure(input: {
    employeeIdHex: string;
    verifierIdHex: string;
    expiresAt: bigint;
    nonceHex: string;
    witness: PrivateEmployeeWitness;
  }): Promise<{ transactionId: string; disclosureIdHex: string }>;

  revokeDisclosure(input: {
    employeeIdHex: string;
    disclosureIdHex: string;
    witness: PrivateEmployeeWitness;
  }): Promise<{ transactionId: string }>;
}

let activeGateway: PayrollContractGateway | undefined;

/**
 * Register only a real adapter backed by generated Compact bindings and
 * Midnight providers. The UI intentionally has no simulated fallback.
 */
export function registerPayrollContractGateway(gateway: PayrollContractGateway): void {
  activeGateway = gateway;
}

export function clearPayrollContractGateway(): void {
  activeGateway = undefined;
}

export function getPayrollContractGateway(): PayrollContractGateway {
  if (!activeGateway) {
    throw new Error(
      "Blackpay Compact bindings are not active. Compile contract/payroll.compact and register the real Midnight adapter before sending payroll state transactions.",
    );
  }
  return activeGateway;
}
