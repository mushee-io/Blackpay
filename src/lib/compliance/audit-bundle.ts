import type { PublicAuditBundle } from "../payroll/types";

const HEX_32 = /^(0x)?[0-9a-fA-F]{64}$/;

function normalizeReference(value: string, label: string): string {
  const trimmed = value.trim();
  if (!HEX_32.test(trimmed)) {
    throw new Error(`${label} must be a 32-byte hex reference`);
  }
  return trimmed.toLowerCase().replace(/^0x/, "");
}

function normalizeReferences(values: string[], label: string): string[] {
  return [...new Set(values.filter((value) => value.trim()).map((value) => normalizeReference(value, label)))];
}

export function buildPublicAuditBundle(input: {
  network: string;
  contractAddress: string;
  proofIds?: string[];
  disclosureIds?: string[];
  transactionCommitments?: string[];
}): PublicAuditBundle {
  if (!input.network.trim()) throw new Error("Network is required");
  if (!input.contractAddress.trim()) throw new Error("Contract address is required");

  return {
    version: "blackpay-audit-v1",
    generatedAt: new Date().toISOString(),
    network: input.network.trim(),
    contractAddress: input.contractAddress.trim(),
    proofIds: normalizeReferences(input.proofIds ?? [], "Proof ID"),
    disclosureIds: normalizeReferences(input.disclosureIds ?? [], "Disclosure ID"),
    transactionCommitments: normalizeReferences(input.transactionCommitments ?? [], "Transaction commitment"),
    privacyStatement:
      "This bundle intentionally excludes salary amounts, payout destinations, employee salts, private witnesses, and private pay-run inputs.",
  };
}
