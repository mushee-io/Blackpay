import type { PayrollFrequency } from "../payroll/types";

export type PrivateEmployeeWitness = {
  salaryMinor: bigint;
  payoutCommitmentHex: string;
  payoutCoinPublicKeyHex: string;
  saltHex: string;
};

export type PrivatePayRunWitness = {
  totalPayrollMinor: bigint;
  paymentsRootHex: string;
  saltHex: string;
};

export type PrivateSettlementPayment = {
  employeeIdHex: string;
  amountMinor: bigint;
  payoutCoinPublicKeyHex: string;
  paymentSaltHex: string;
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
    tokenColorHex: string;
    payments: PrivateSettlementPayment[];
  }): Promise<{ transactionId: string; registrationTransactionIds: string[] }>;

  approvePayRun(payRunIdHex: string): Promise<{ transactionId: string }>;

  fundPayRunPayment(input: {
    payRunIdHex: string;
    employeeIdHex: string;
  }): Promise<{ transactionId?: string; claimIdHex: string; candidateMtIndices: string[]; alreadyFunded: boolean }>;

  claimPayRunPayment(input: {
    payRunIdHex: string;
    employeeIdHex: string;
  }): Promise<{ transactionId: string; claimIdHex: string }>;

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
const gatewayListeners = new Set<(ready: boolean) => void>();

function emitGatewayReadiness(): void {
  const ready = Boolean(activeGateway);
  for (const listener of gatewayListeners) listener(ready);
}

export function registerPayrollContractGateway(gateway: PayrollContractGateway): void {
  activeGateway = gateway;
  emitGatewayReadiness();
}

export function clearPayrollContractGateway(): void {
  activeGateway = undefined;
  emitGatewayReadiness();
}

export function isPayrollContractGatewayReady(): boolean {
  return Boolean(activeGateway);
}

export function subscribePayrollContractGateway(listener: (ready: boolean) => void): () => void {
  gatewayListeners.add(listener);
  listener(Boolean(activeGateway));
  return () => gatewayListeners.delete(listener);
}

export function getPayrollContractGateway(): PayrollContractGateway {
  if (!activeGateway) {
    throw new Error(
      "Blackpay v2 live runtime is not active. Connect Lace, then deploy or join a verified protocol-v2 contract before sending payroll transactions.",
    );
  }
  return activeGateway;
}
