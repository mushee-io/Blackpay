import type { PrivateStateExport, SigningKeyExport } from "@midnight-ntwrk/midnight-js-types";
import { buildBlackpayProviders } from "./providers";
import { initializeBlackpayPreview } from "./live-runtime";
import { assertWalletStillConnected, type ConnectedWallet } from "./wallet";

export type BlackpayEncryptedBackup = {
  format: "blackpay-encrypted-backup-v1";
  networkId: string;
  contractAddress: string;
  privateStates: PrivateStateExport;
  signingKeys: SigningKeyExport;
};

const MAX_ENCRYPTED_EXPORT_CHARS = 8_000_000;
const MAX_SALT_CHARS = 4096;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validateEncryptedExportFields(value: Record<string, unknown>, label: string): void {
  if (typeof value.encryptedPayload !== "string" || typeof value.salt !== "string") {
    throw new Error(`${label} is malformed`);
  }
  if (!value.encryptedPayload || value.encryptedPayload.length > MAX_ENCRYPTED_EXPORT_CHARS) {
    throw new Error(`${label} payload is outside the supported size limit`);
  }
  if (!value.salt || value.salt.length > MAX_SALT_CHARS) {
    throw new Error(`${label} salt is outside the supported size limit`);
  }
}

function validatePrivateStateExport(value: unknown): asserts value is PrivateStateExport {
  if (!isRecord(value) || value.format !== "midnight-private-state-export") {
    throw new Error("Backup contains an invalid Midnight private-state export");
  }
  validateEncryptedExportFields(value, "Backup private-state export");
}

function validateSigningKeyExport(value: unknown): asserts value is SigningKeyExport {
  if (!isRecord(value) || value.format !== "midnight-signing-key-export") {
    throw new Error("Backup contains an invalid Midnight signing-key export");
  }
  validateEncryptedExportFields(value, "Backup signing-key export");
}

export function parseBlackpayEncryptedBackup(value: unknown): BlackpayEncryptedBackup {
  if (!isRecord(value) || value.format !== "blackpay-encrypted-backup-v1") {
    throw new Error("This file is not a Blackpay encrypted backup");
  }
  if (typeof value.networkId !== "string" || !/^[A-Za-z0-9._-]{1,64}$/.test(value.networkId.trim())) {
    throw new Error("Backup network identifier is invalid");
  }
  if (typeof value.contractAddress !== "string" || !/^[0-9a-f]{64}$/i.test(value.contractAddress.trim())) {
    throw new Error("Backup contract address is invalid");
  }
  validatePrivateStateExport(value.privateStates);
  validateSigningKeyExport(value.signingKeys);
  return {
    ...(value as BlackpayEncryptedBackup),
    networkId: value.networkId.trim(),
    contractAddress: value.contractAddress.trim().toLowerCase(),
  };
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
  if (!params.backupPassword || params.backupPassword.length > 256) throw new Error("Backup decryption password is required and must be within the supported length");

  await assertWalletStillConnected(params.wallet);
  const providers = await buildBlackpayProviders(params.wallet, params.storagePassword);
  const contractAddress = parsed.contractAddress as Parameters<typeof providers.privateStateProvider.setContractAddress>[0];
  const existingContract = await providers.publicDataProvider.queryContractState(contractAddress as never);
  if (!existingContract) throw new Error("Backup contract was not found on the connected Midnight network. Private state was not overwritten.");

  providers.privateStateProvider.setContractAddress(contractAddress);
  await assertWalletStillConnected(params.wallet);

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
