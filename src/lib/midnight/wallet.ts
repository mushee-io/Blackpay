import type { Configuration, ConnectedAPI, InitialAPI } from "@midnight-ntwrk/dapp-connector-api";
import { setNetworkId } from "@midnight-ntwrk/midnight-js-network-id";
import { getMidnightPublicConfig } from "./network";

export type AvailableWallet = {
  id: string;
  name: string;
  rdns: string;
  apiVersion: string;
  api: InitialAPI;
};

export type ConnectedWallet = {
  id: string;
  name: string;
  api: ConnectedAPI;
  configuration: Configuration;
  networkId: string;
  addresses: {
    shieldedAddress: string;
    shieldedCoinPublicKey: string;
    shieldedEncryptionPublicKey: string;
  };
};

type MidnightWindow = Window & {
  midnight?: Record<string, InitialAPI>;
};

let activeConnection: ConnectedWallet | null = null;

function injectedWallets(): Record<string, InitialAPI> {
  if (typeof window === "undefined") return {};
  return (window as MidnightWindow).midnight ?? {};
}

export function listMidnightWallets(): AvailableWallet[] {
  return Object.entries(injectedWallets())
    .filter(([, api]) => api && typeof api.connect === "function")
    .map(([id, api]) => ({
      id,
      name: api.name || "Midnight wallet",
      rdns: api.rdns || "unknown",
      apiVersion: api.apiVersion || "unknown",
      api,
    }));
}

function chooseWallet(walletId?: string): AvailableWallet {
  const wallets = listMidnightWallets();
  if (wallets.length === 0) throw new Error("No Midnight DApp Connector wallet detected. Install Lace with Midnight support.");
  if (walletId) {
    const selected = wallets.find((wallet) => wallet.id === walletId);
    if (!selected) throw new Error("The selected Midnight wallet is no longer available");
    return selected;
  }
  const lace = wallets.find((wallet) => /lace/i.test(`${wallet.name} ${wallet.rdns}`));
  return lace ?? wallets[0];
}

function assertRequestedNetwork(actual: string, requested: string): void {
  if (actual !== requested) {
    throw new Error(`Midnight network mismatch: Blackpay requires ${requested}, wallet is connected to ${actual}`);
  }
}

function assertServiceConfiguration(configuration: Configuration, requestedNetwork: string): void {
  assertRequestedNetwork(configuration.networkId, requestedNetwork);
  if (!configuration.indexerUri.trim()) throw new Error("Wallet returned no Midnight indexer URI");
  if (!configuration.indexerWsUri.trim()) throw new Error("Wallet returned no Midnight indexer WebSocket URI");
  if (!configuration.substrateNodeUri.trim()) throw new Error("Wallet returned no Midnight substrate node URI");
}

export async function connectMidnightWallet(walletId?: string): Promise<ConnectedWallet> {
  const selected = chooseWallet(walletId);
  const requestedNetwork = getMidnightPublicConfig().network;

  const api = await selected.api.connect(requestedNetwork);
  const status = await api.getConnectionStatus();
  if (status.status !== "connected") throw new Error("Midnight wallet connection was not authorized");
  assertRequestedNetwork(status.networkId, requestedNetwork);

  const configuration = await api.getConfiguration();
  assertServiceConfiguration(configuration, requestedNetwork);
  const addresses = await api.getShieldedAddresses();

  if (!addresses.shieldedAddress.trim()) throw new Error("Wallet returned no shielded address");
  if (!addresses.shieldedCoinPublicKey.trim()) throw new Error("Wallet returned no shielded coin public key");
  if (!addresses.shieldedEncryptionPublicKey.trim()) throw new Error("Wallet returned no shielded encryption public key");

  await api.hintUsage([
    "getShieldedAddresses",
    "getConfiguration",
    "getConnectionStatus",
    "balanceUnsealedTransaction",
    "submitTransaction",
    "getProvingProvider",
    "makeTransfer",
  ]);

  setNetworkId(status.networkId);
  activeConnection = {
    id: selected.id,
    name: selected.name,
    api,
    configuration,
    networkId: status.networkId,
    addresses,
  };
  return activeConnection;
}

export function getConnectedMidnightWallet(): ConnectedWallet {
  if (!activeConnection) throw new Error("Connect a Midnight wallet from the Blackpay header first");
  return activeConnection;
}

export async function assertWalletStillConnected(wallet: ConnectedWallet): Promise<void> {
  const status = await wallet.api.getConnectionStatus();
  if (status.status !== "connected") {
    if (activeConnection?.id === wallet.id) activeConnection = null;
    throw new Error("Midnight wallet session is no longer connected");
  }
  assertRequestedNetwork(status.networkId, wallet.networkId);
}
