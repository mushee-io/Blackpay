import { NextResponse } from "next/server";
import { getMidnightPublicConfig } from "@/lib/midnight/network";

export const dynamic = "force-dynamic";

export function GET() {
  const config = getMidnightPublicConfig();

  return NextResponse.json(
    {
      service: "blackpay",
      appVersion: "0.4.3",
      protocolVersion: 2,
      network: config.network,
      canonicalContractConfigured: Boolean(config.contractAddress),
      infrastructure: "lace-wallet-managed",
      settlement: "register-fund-claim",
      employeeAccess: "v3-encrypted",
      privacyMode: "fail-closed",
      milestones: {
        foundation: "coded-verify",
        payroll: "protocol-v2-coded-verify",
        selectiveDisclosure: "coded-verify",
        employeePortal: "v2-claim-coded-verify",
        compliance: "coded-verify",
        sdk: "protocol-v2-coded-verify",
      },
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
