export type PayrollFrequency = "weekly" | "biweekly" | "monthly";
export type EmployeeStatus = "active" | "inactive";
export type PayRunStatus = "draft" | "approved" | "executed";
export type DisclosureKind = "employment-active" | "income-at-least";
export type PayslipStatus = "submitted" | "finalized";

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

export type SelectiveDisclosureRecord = {
  disclosureId: string;
  employeeCommitment: string;
  kind: DisclosureKind;
  verifierId: string;
  expiresAt: bigint;
  revoked: boolean;
};

export type PrivatePayslip = {
  employeeIdHex: string;
  payRunIdHex: string;
  period: number;
  grossMinor: bigint;
  netMinor: bigint;
  currencyCode: string;
  paymentTransactionId: string;
  status: PayslipStatus;
  createdAt: number;
};

export type PublicAuditBundle = {
  version: "blackpay-audit-v1";
  generatedAt: string;
  network: string;
  contractAddress: string;
  proofIds: string[];
  disclosureIds: string[];
  transactionCommitments: string[];
  privacyStatement: string;
};
