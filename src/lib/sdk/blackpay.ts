import {
  getPayrollContractGateway,
  type PayrollContractGateway,
  type PrivateEmployeeWitness,
  type PrivatePayRunWitness,
} from "../midnight/contract-client";
import type { PayrollFrequency } from "../payroll/types";

export class BlackpaySdk {
  readonly gateway: PayrollContractGateway;

  constructor(gateway: PayrollContractGateway = getPayrollContractGateway()) {
    this.gateway = gateway;
  }

  createWorkspace(input: { workspaceIdHex: string; currencyIdHex: string; frequency: PayrollFrequency }) {
    return this.gateway.createWorkspace(input);
  }

  addEmployee(input: { employeeIdHex: string; witness: PrivateEmployeeWitness }) {
    return this.gateway.addEmployee(input);
  }

  createPayRun(input: {
    payRunIdHex: string;
    period: number;
    employeeCount: number;
    witness: PrivatePayRunWitness;
  }) {
    return this.gateway.createPayRun(input);
  }

  approvePayRun(payRunIdHex: string) {
    return this.gateway.approvePayRun(payRunIdHex);
  }

  finalizePayRun(input: { payRunIdHex: string; transactionCommitmentHex: string }) {
    return this.gateway.finalizePayRun(input);
  }

  proveIncomeAtLeast(input: {
    employeeIdHex: string;
    thresholdMinor: bigint;
    nonceHex: string;
    witness: PrivateEmployeeWitness;
  }) {
    return this.gateway.proveIncomeAtLeast(input);
  }

  createIncomeDisclosure(input: {
    employeeIdHex: string;
    thresholdMinor: bigint;
    verifierIdHex: string;
    expiresAt: bigint;
    nonceHex: string;
    witness: PrivateEmployeeWitness;
  }) {
    return this.gateway.createIncomeDisclosure(input);
  }

  createEmploymentDisclosure(input: {
    employeeIdHex: string;
    verifierIdHex: string;
    expiresAt: bigint;
    nonceHex: string;
    witness: PrivateEmployeeWitness;
  }) {
    return this.gateway.createEmploymentDisclosure(input);
  }

  revokeDisclosure(input: {
    employeeIdHex: string;
    disclosureIdHex: string;
    witness: PrivateEmployeeWitness;
  }) {
    return this.gateway.revokeDisclosure(input);
  }
}
