import { NextResponse } from "next/server";
import { getMidnightPublicConfig } from "@/lib/midnight/network";

export function GET() {
  const config = getMidnightPublicConfig();
  return NextResponse.json({
    service: "blackpay",
    status: "ok",
    network: config.network,
    proofServerConfigured: Boolean(config.proofServerUrl),
    indexerConfigured: Boolean(config.indexerUrl),
    nodeConfigured: Boolean(config.nodeUrl),
    contractConfigured: Boolean(config.contractAddress),
    payrollTokenConfigured: Boolean(config.payrollTokenType),
    privacyMode: "fail-closed",
  });
}
