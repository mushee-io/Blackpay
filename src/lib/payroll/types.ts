export type PayrollFrequency = "weekly" | "biweekly" | "monthly";
export type EmployeeStatus = "active" | "inactive";
export type PayRunStatus = "draft" | "approved" | "executed";

export type EmployerWorkspaceInput = {
  companyName: string;
  currencyCode: string;
  frequency: PayrollFrequency;
};

export type PrivateEmployeeInput = {
  employeeId: string;
  salaryMinor: bigint;
  shieldedRecipient: string;
  saltHex: string;
};

export type EmployeeCommitmentRecord = {
  employeeId: string;
  commitment: string;
  status: EmployeeStatus;
  revision: number;
};

export type PrivatePayrollPayment = {
  employeeId: string;
  salaryMinor: bigint;
  shieldedRecipient: string;
};

export type PrivatePayRunInput = {
  payRunId: string;
  period: number;
  payments: PrivatePayrollPayment[];
  saltHex: string;
};

export type PayRunRecord = {
  payRunId: string;
  commitment: string;
  period: number;
  employeeCount: number;
  status: PayRunStatus;
  transactionCommitment?: string;
};

export type IncomeThresholdRequest = {
  employeeId: string;
  thresholdMinor: bigint;
  nonceHex: string;
};

export type IncomeThresholdProof = {
  proofId: string;
  employeeCommitment: string;
  thresholdMinor: bigint;
  satisfied: true;
};
