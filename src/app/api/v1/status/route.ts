import { NextResponse } from "next/server";
import { getMidnightPublicConfig } from "@/lib/midnight/network";

export const dynamic = "force-dynamic";

export function GET() {
  const config = getMidnightPublicConfig();
  const contractConfigured = Boolean(config.contractAddress);
  const servicesConfigured = Boolean(config.indexerUrl && config.nodeUrl && config.proofServerUrl);

  return NextResponse.json(
    {
      service: "blackpay",
      version: "0.2.0",
      network: config.network,
      contractConfigured,
      servicesConfigured,
      privacyMode: "fail-closed",
      milestones: {
        foundation: "coded-verify",
        payroll: "coded-verify",
        selectiveDisclosure: "coded-verify",
        employeePortal: "coded-verify",
        compliance: "coded-verify",
        sdk: "coded-verify",
      },
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
