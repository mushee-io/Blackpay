import { NextResponse } from "next/server";
import { getMidnightPublicConfig } from "@/lib/midnight/network";

export function GET() {
  const config = getMidnightPublicConfig();
  return NextResponse.json({
    service: "blackpay",
    status: "ok",
    protocolVersion: 2,
    network: config.network,
    midnightInfrastructure: "lace-wallet-managed",
    canonicalContractConfigured: Boolean(config.contractAddress),
    payrollTokenDefaultConfigured: Boolean(config.payrollTokenType),
    settlement: "register-fund-claim",
    privacyMode: "fail-closed",
  });
}
