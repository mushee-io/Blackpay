export const MIDNIGHT_NETWORKS = ["preview", "preprod"] as const;
export type MidnightNetwork = (typeof MIDNIGHT_NETWORKS)[number];

export type MidnightPublicConfig = {
  network: MidnightNetwork;
  proofServerUrl: string;
  indexerUrl: string;
  indexerWsUrl: string;
  nodeUrl: string;
  contractAddress: string;
  payrollTokenType: string;
};

function requireNetwork(value: string | undefined): MidnightNetwork {
  const network = (value ?? "preview").toLowerCase();
  if (network !== "preview" && network !== "preprod") {
    throw new Error(`Unsupported Midnight network: ${network}`);
  }
  return network;
}

export function getMidnightPublicConfig(): MidnightPublicConfig {
  return {
    network: requireNetwork(process.env.NEXT_PUBLIC_MIDNIGHT_NETWORK),
    proofServerUrl: process.env.NEXT_PUBLIC_MIDNIGHT_PROOF_SERVER_URL ?? "http://127.0.0.1:6300",
    indexerUrl: process.env.NEXT_PUBLIC_MIDNIGHT_INDEXER_URL ?? "",
    indexerWsUrl: process.env.NEXT_PUBLIC_MIDNIGHT_INDEXER_WS_URL ?? "",
    nodeUrl: process.env.NEXT_PUBLIC_MIDNIGHT_NODE_URL ?? "",
    contractAddress: process.env.NEXT_PUBLIC_BLACKPAY_CONTRACT_ADDRESS ?? "",
    payrollTokenType: process.env.NEXT_PUBLIC_PAYROLL_TOKEN_TYPE ?? "",
  };
}

export function assertDeploymentConfig(config = getMidnightPublicConfig()): MidnightPublicConfig {
  const missing = [
    ["NEXT_PUBLIC_MIDNIGHT_INDEXER_URL", config.indexerUrl],
    ["NEXT_PUBLIC_MIDNIGHT_NODE_URL", config.nodeUrl],
    ["NEXT_PUBLIC_BLACKPAY_CONTRACT_ADDRESS", config.contractAddress],
  ].filter(([, value]) => !value);

  if (missing.length > 0) {
    throw new Error(`Blackpay deployment is not configured: ${missing.map(([name]) => name).join(", ")}`);
  }
  return config;
}
