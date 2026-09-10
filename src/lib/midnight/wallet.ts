import { getMidnightPublicConfig } from "./network";

export type ShieldedTransferOutput = {
  kind: "shielded";
  tokenType: string;
  value: bigint;
  recipient: string;
};

export type WalletConnectionStatus = {
  networkId?: string;
  [key: string]: unknown;
};

export interface ConnectedMidnightWallet {
  getConnectionStatus?: () => Promise<WalletConnectionStatus | string>;
  getShieldedAddresses?: () => Promise<unknown>;
  getUnshieldedAddress?: () => Promise<string>;
  makeTransfer: (outputs: ShieldedTransferOutput[]) => Promise<unknown>;
  submitTransaction: (transaction: unknown) => Promise<unknown>;
}

export interface InjectedMidnightWallet {
  name?: string;
  icon?: string;
  apiVersion?: string;
  connect: (networkId?: string) => Promise<ConnectedMidnightWallet>;
}

declare global {
  interface Window {
    midnight?: Record<string, InjectedMidnightWallet>;
  }
}

export type AvailableWallet = {
  id: string;
  name: string;
  apiVersion: string;
  icon?: string;
};

export type ConnectedWallet = AvailableWallet & {
  api: ConnectedMidnightWallet;
};

export function listMidnightWallets(): AvailableWallet[] {
  if (typeof window === "undefined") return [];
  return Object.entries(window.midnight ?? {})
    .filter(([, wallet]) => typeof wallet?.connect === "function")
    .map(([id, wallet]) => ({
      id,
      name: wallet.name ?? id,
      apiVersion: wallet.apiVersion ?? "unknown",
      icon: wallet.icon,
    }));
}

function normalizeNetworkId(status: WalletConnectionStatus | string | undefined): string | undefined {
  if (typeof status === "string") return status.toLowerCase();
  if (status && typeof status.networkId === "string") return status.networkId.toLowerCase();
  return undefined;
}

export async function connectMidnightWallet(walletId?: string): Promise<ConnectedWallet> {
  if (typeof window === "undefined") throw new Error("Wallet connection is only available in the browser");

  const injected = window.midnight ?? {};
  const entries = Object.entries(injected).filter(([, wallet]) => typeof wallet?.connect === "function");
  if (entries.length === 0) throw new Error("No Midnight-compatible wallet was detected");

  const selected = walletId
    ? entries.find(([id]) => id === walletId)
    : entries.length === 1
      ? entries[0]
      : undefined;

  if (!selected) {
    if (walletId) throw new Error(`Midnight wallet '${walletId}' was not found`);
    throw new Error("Multiple Midnight wallets detected; select one explicitly");
  }

  const [id, wallet] = selected;
  const config = getMidnightPublicConfig();
  const api = await wallet.connect(config.network);

  if (!api || typeof api.makeTransfer !== "function" || typeof api.submitTransaction !== "function") {
    throw new Error("Connected wallet does not expose the required Midnight transaction API");
  }

  const status = api.getConnectionStatus ? await api.getConnectionStatus() : undefined;
  const connectedNetwork = normalizeNetworkId(status);
  if (connectedNetwork && !connectedNetwork.includes(config.network)) {
    throw new Error(`Wallet network mismatch: expected ${config.network}, received ${connectedNetwork}`);
  }

  return {
    id,
    name: wallet.name ?? id,
    apiVersion: wallet.apiVersion ?? "unknown",
    icon: wallet.icon,
    api,
  };
}
