import type { PrivateStateExport, SigningKeyExport } from "@midnight-ntwrk/midnight-js-types";
import { buildBlackpayProviders } from "./providers";
import { initializeBlackpayPreview } from "./live-runtime";
import type { ConnectedWallet } from "./wallet";

export type BlackpayEncryptedBackup = {
  format: "blackpay-encrypted-backup-v1";
  networkId: string;
  contractAddress: string;
  privateStates: PrivateStateExport;
  signingKeys: SigningKeyExport;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validatePrivateStateExport(value: unknown): asserts value is PrivateStateExport {
  if (!isRecord(value) || value.format !== "midnight-private-state-export") {
    throw new Error("Backup contains an invalid Midnight private-state export");
  }
  if (typeof value.encryptedPayload !== "string" || typeof value.salt !== "string") {
    throw new Error("Backup private-state payload is malformed");
  }
}

function validateSigningKeyExport(value: unknown): asserts value is SigningKeyExport {
  if (!isRecord(value) || value.format !== "midnight-signing-key-export") {
    throw new Error("Backup contains an invalid Midnight signing-key export");
  }
  if (typeof value.encryptedPayload !== "string" || typeof value.salt !== "string") {
    throw new Error("Backup signing-key payload is malformed");
  }
}

export function parseBlackpayEncryptedBackup(value: unknown): BlackpayEncryptedBackup {
  if (!isRecord(value) || value.format !== "blackpay-encrypted-backup-v1") {
    throw new Error("This file is not a Blackpay encrypted backup");
  }
  if (typeof value.networkId !== "string" || !value.networkId.trim()) {
    throw new Error("Backup network identifier is missing");
  }
  if (typeof value.contractAddress !== "string" || !value.contractAddress.trim()) {
    throw new Error("Backup contract address is missing");
  }
  validatePrivateStateExport(value.privateStates);
  validateSigningKeyExport(value.signingKeys);
  return value as BlackpayEncryptedBackup;
}

export async function restoreBlackpayEncryptedBackup(params: {
  wallet: ConnectedWallet;
  storagePassword: string;
  backupPassword: string;
  backup: unknown;
}): Promise<{ contractAddress: string; role: "admin" | "employee" }> {
  const parsed = parseBlackpayEncryptedBackup(params.backup);
  if (parsed.networkId !== params.wallet.networkId) {
    throw new Error(`Backup is for ${parsed.networkId}; connected wallet is on ${params.wallet.networkId}`);
  }
  if (!params.backupPassword) throw new Error("Backup decryption password is required");

  const providers = await buildBlackpayProviders(params.wallet, params.storagePassword);
  const contractAddress = parsed.contractAddress.trim() as Parameters<typeof providers.privateStateProvider.setContractAddress>[0];
  providers.privateStateProvider.setContractAddress(contractAddress);

  await providers.privateStateProvider.importPrivateStates(parsed.privateStates, {
    password: params.backupPassword,
    conflictStrategy: "overwrite",
    maxStates: 32,
  });
  await providers.privateStateProvider.importSigningKeys(parsed.signingKeys, {
    password: params.backupPassword,
    conflictStrategy: "overwrite",
    maxKeys: 32,
  });

  const joined = await initializeBlackpayPreview({
    wallet: params.wallet,
    privateStatePassword: params.storagePassword,
    mode: "join",
    contractAddress: parsed.contractAddress,
  });

  return { contractAddress: joined.contractAddress, role: joined.role };
}
