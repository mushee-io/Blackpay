export const MIDNIGHT_NETWORKS = ["preview", "preprod"] as const;
export type MidnightNetwork = (typeof MIDNIGHT_NETWORKS)[number];

export type MidnightPublicConfig = {
  network: MidnightNetwork;
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
    contractAddress: process.env.NEXT_PUBLIC_BLACKPAY_CONTRACT_ADDRESS ?? "",
    payrollTokenType: process.env.NEXT_PUBLIC_PAYROLL_TOKEN_TYPE ?? "",
  };
}

/**
 * This validates only public app defaults. Indexer, websocket, substrate-node,
 * and proving configuration are intentionally obtained from the connected Lace
 * wallet at runtime and must not be duplicated in NEXT_PUBLIC_* variables.
 */
export function assertDeploymentConfig(config = getMidnightPublicConfig()): MidnightPublicConfig {
  if (!config.contractAddress.trim()) {
    throw new Error("Blackpay deployment is not configured: NEXT_PUBLIC_BLACKPAY_CONTRACT_ADDRESS");
  }
  return config;
}
