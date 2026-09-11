export type EmployeeAccessPayslipPayload = {
  payRunIdHex: string;
  period: number;
  grossMinor: string;
  netMinor: string;
  currencyCode: string;
  status: "pending" | "approved" | "paid";
  paymentTransactionId?: string;
  createdAt: number;
};

type EmployeeAccessCorePayload = {
  employeeIdHex: string;
  salaryMinor: string;
  payoutCommitmentHex: string;
  saltHex: string;
  payslips: EmployeeAccessPayslipPayload[];
};

type EmployeeAccessPayloadV1 = EmployeeAccessCorePayload & {
  version: "blackpay-employee-access-v1";
};

type EmployeeAccessPayloadV2 = EmployeeAccessCorePayload & {
  version: "blackpay-employee-access-v2";
  networkId: string;
  contractAddress: string;
  packageId: string;
};

export type EmployeeAccessPayload = EmployeeAccessPayloadV1 | EmployeeAccessPayloadV2;

type EnvelopeCipher = {
  name: "AES-GCM";
  iv: string;
  ciphertext: string;
};

type EmployeeAccessEnvelopeV1 = {
  format: "blackpay-employee-access-envelope-v1";
  networkId: string;
  contractAddress: string;
  createdAt: string;
  kdf: { name: "PBKDF2"; hash: "SHA-256"; iterations: 250000; salt: string };
  cipher: EnvelopeCipher;
};

type EmployeeAccessEnvelopeV2 = {
  format: "blackpay-employee-access-envelope-v2";
  networkId: string;
  contractAddress: string;
  packageId: string;
  createdAt: string;
  expiresAt: string;
  kdf: { name: "PBKDF2"; hash: "SHA-256"; iterations: 600000; salt: string };
  cipher: EnvelopeCipher;
};

export type EmployeeAccessEnvelope = EmployeeAccessEnvelopeV1 | EmployeeAccessEnvelopeV2;

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const UINT64_MAX = (1n << 64n) - 1n;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
const PACKAGE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_PAYSLIPS = 240;

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} is invalid`);
  return value as Record<string, unknown>;
}

function stringField(record: Record<string, unknown>, key: string, label: string): string {
  const value = record[key];
  if (typeof value !== "string") throw new Error(`${label} is invalid`);
  return value;
}

function assertBrowserCrypto(): Crypto {
  if (typeof crypto === "undefined" || !crypto.subtle || typeof crypto.getRandomValues !== "function") {
    throw new Error("Secure browser cryptography is required for employee access packages");
  }
  return crypto;
}

function assertLegacyPassword(password: string): void {
  if (password.length < 16) throw new Error("Employee access password must be at least 16 characters");
  if (password.length > 256) throw new Error("Employee access password is too long");
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((pattern) => pattern.test(password)).length;
  if (classes < 3) throw new Error("Employee access password must use at least three character types");
}

function assertStrongPassword(password: string): void {
  assertLegacyPassword(password);
  if (/(.)\1\1\1/.test(password)) throw new Error("Employee access password cannot contain four repeated characters");
  if (/0123|1234|2345|3456|4567|5678|6789|abcd|bcde|cdef/i.test(password)) {
    throw new Error("Employee access password contains an unsafe sequential pattern");
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function base64ToBytes(value: string, label: string): Uint8Array {
  if (!value || value.length > 1_600_000) throw new Error(`${label} is invalid`);
  try {
    const binary = atob(value);
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    throw new Error(`${label} contains invalid base64 data`);
  }
}

function ownedArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function assertNetworkId(value: string): string {
  const normalized = value.trim();
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(normalized)) throw new Error("Employee access package has an invalid network ID");
  return normalized;
}

function assertContractAddress(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalized)) throw new Error("Employee access package has an invalid contract address");
  return normalized;
}

function assertIsoDate(value: string, label: string): number {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new Error(`${label} is invalid`);
  return timestamp;
}

function additionalData(envelope: EmployeeAccessEnvelopeV2): Uint8Array {
  return encoder.encode([
    "blackpay-employee-access-envelope-v2",
    envelope.networkId,
    envelope.contractAddress,
    envelope.packageId,
    envelope.createdAt,
    envelope.expiresAt,
  ].join("\n"));
}

async function deriveKey(password: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const webCrypto = assertBrowserCrypto();
  const material = await webCrypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveKey"]);
  return webCrypto.subtle.deriveKey(
    { name: "PBKDF2", salt: ownedArrayBuffer(salt), iterations, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

function assertUintString(value: string, label: string): bigint {
  if (!/^[0-9]+$/.test(value)) throw new Error(`${label} is invalid`);
  const parsed = BigInt(value);
  if (parsed <= 0n || parsed > UINT64_MAX) throw new Error(`${label} is outside the supported range`);
  return parsed;
}

function normalizePayslip(value: unknown, seenPayRuns: Set<string>): EmployeeAccessPayslipPayload {
  const payslip = asRecord(value, "Employee access payslip");
  const payRunIdHex = stringField(payslip, "payRunIdHex", "Employee access payslip pay-run identifier").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(payRunIdHex)) throw new Error("Employee access payslip has an invalid pay-run identifier");
  if (seenPayRuns.has(payRunIdHex)) throw new Error("Employee access payload contains duplicate pay-run payslips");
  seenPayRuns.add(payRunIdHex);

  const period = payslip.period;
  if (typeof period !== "number" || !Number.isSafeInteger(period) || period <= 0 || period > 0xffffffff) {
    throw new Error("Employee access payslip has an invalid period");
  }
  const grossMinor = stringField(payslip, "grossMinor", "Employee access payslip gross amount");
  const netMinor = stringField(payslip, "netMinor", "Employee access payslip net amount");
  const gross = assertUintString(grossMinor, "Employee access payslip gross amount");
  const net = assertUintString(netMinor, "Employee access payslip net amount");
  if (net > gross) throw new Error("Employee access payslip net amount cannot exceed gross amount");

  const currencyCode = stringField(payslip, "currencyCode", "Employee access payslip currency").toUpperCase();
  if (!/^[A-Z0-9._-]{1,24}$/.test(currencyCode)) throw new Error("Employee access payslip has an invalid currency code");
  const status = payslip.status;
  if (status !== "pending" && status !== "approved" && status !== "paid") throw new Error("Employee access payslip has an invalid status");
  const createdAt = payslip.createdAt;
  if (typeof createdAt !== "number" || !Number.isSafeInteger(createdAt) || createdAt <= 0 || createdAt > Date.now() + MAX_CLOCK_SKEW_MS) {
    throw new Error("Employee access payslip has an invalid creation time");
  }

  const paymentTransactionId = payslip.paymentTransactionId;
  if (paymentTransactionId !== undefined && typeof paymentTransactionId !== "string") {
    throw new Error("Employee access payslip has an invalid settlement transaction identifier");
  }
  if (typeof paymentTransactionId === "string") {
    if (paymentTransactionId !== paymentTransactionId.trim() || !/^[0-9A-Za-z:_-]{16,256}$/.test(paymentTransactionId)) {
      throw new Error("Employee access payslip has an invalid settlement transaction identifier");
    }
  }

  return {
    payRunIdHex,
    period,
    grossMinor,
    netMinor,
    currencyCode,
    status,
    ...(typeof paymentTransactionId === "string" ? { paymentTransactionId } : {}),
    createdAt,
  };
}

function normalizeCorePayload(record: Record<string, unknown>): EmployeeAccessCorePayload {
  const employeeIdHex = stringField(record, "employeeIdHex", "Employee access employee identifier").toLowerCase();
  const payoutCommitmentHex = stringField(record, "payoutCommitmentHex", "Employee access payout commitment").toLowerCase();
  const saltHex = stringField(record, "saltHex", "Employee access private salt").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(employeeIdHex)) throw new Error("Employee access payload has an invalid employee identifier");
  if (!/^[0-9a-f]{64}$/.test(payoutCommitmentHex)) throw new Error("Employee access payload has an invalid payout commitment");
  if (!/^[0-9a-f]{64}$/.test(saltHex)) throw new Error("Employee access payload has an invalid private salt");
  const salaryMinor = stringField(record, "salaryMinor", "Employee access salary");
  assertUintString(salaryMinor, "Employee access salary");
  const rawPayslips = record.payslips;
  if (!Array.isArray(rawPayslips) || rawPayslips.length > MAX_PAYSLIPS) {
    throw new Error("Employee access payload has an invalid payslip collection");
  }
  const seenPayRuns = new Set<string>();
  const payslips = rawPayslips.map((payslip) => normalizePayslip(payslip, seenPayRuns));
  return { employeeIdHex, salaryMinor, payoutCommitmentHex, saltHex, payslips };
}

function assertPayload(value: unknown, envelope?: EmployeeAccessEnvelopeV2): EmployeeAccessPayload {
  const payload = asRecord(value, "Decrypted employee access payload");
  const version = stringField(payload, "version", "Employee access payload version");
  const core = normalizeCorePayload(payload);
  if (version === "blackpay-employee-access-v1") return { version, ...core };
  if (version !== "blackpay-employee-access-v2") throw new Error("Unsupported employee access payload version");
  if (!envelope) throw new Error("Employee access v2 payload is missing authenticated envelope metadata");
  const networkId = assertNetworkId(stringField(payload, "networkId", "Employee access payload network ID"));
  const contractAddress = assertContractAddress(stringField(payload, "contractAddress", "Employee access payload contract address"));
  const packageId = stringField(payload, "packageId", "Employee access payload package identifier").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(packageId)) throw new Error("Employee access payload has an invalid package identifier");
  if (networkId !== envelope.networkId || contractAddress !== envelope.contractAddress || packageId !== envelope.packageId) {
    throw new Error("Employee access package metadata does not match its authenticated payload");
  }
  return { version, networkId, contractAddress, packageId, ...core };
}

export async function encryptEmployeeAccessPayload(params: {
  networkId: string;
  contractAddress: string;
  password: string;
  payload: EmployeeAccessPayload;
}): Promise<EmployeeAccessEnvelope> {
  assertStrongPassword(params.password);
  const networkId = assertNetworkId(params.networkId);
  const contractAddress = assertContractAddress(params.contractAddress);
  const webCrypto = assertBrowserCrypto();
  const packageId = bytesToHex(webCrypto.getRandomValues(new Uint8Array(32)));
  const createdAtMs = Date.now();
  const createdAt = new Date(createdAtMs).toISOString();
  const expiresAt = new Date(createdAtMs + PACKAGE_TTL_MS).toISOString();
  const salt = webCrypto.getRandomValues(new Uint8Array(32));
  const iv = webCrypto.getRandomValues(new Uint8Array(12));
  const envelopeMeta: EmployeeAccessEnvelopeV2 = {
    format: "blackpay-employee-access-envelope-v2",
    networkId,
    contractAddress,
    packageId,
    createdAt,
    expiresAt,
    kdf: { name: "PBKDF2", hash: "SHA-256", iterations: 600000, salt: "" },
    cipher: { name: "AES-GCM", iv: "", ciphertext: "" },
  };
  const payloadV2 = assertPayload({
    version: "blackpay-employee-access-v2",
    networkId,
    contractAddress,
    packageId,
    employeeIdHex: params.payload.employeeIdHex,
    salaryMinor: params.payload.salaryMinor,
    payoutCommitmentHex: params.payload.payoutCommitmentHex,
    saltHex: params.payload.saltHex,
    payslips: params.payload.payslips,
  }, envelopeMeta);
  const plaintext = encoder.encode(JSON.stringify(payloadV2));
  if (plaintext.byteLength > 1_000_000) throw new Error("Employee access payload is unexpectedly large");
  const key = await deriveKey(params.password, salt, 600000);
  const encrypted = await webCrypto.subtle.encrypt(
    { name: "AES-GCM", iv: ownedArrayBuffer(iv), additionalData: ownedArrayBuffer(additionalData(envelopeMeta)) },
    key,
    ownedArrayBuffer(plaintext),
  );
  return {
    ...envelopeMeta,
    kdf: { ...envelopeMeta.kdf, salt: bytesToBase64(salt) },
    cipher: { ...envelopeMeta.cipher, iv: bytesToBase64(iv), ciphertext: bytesToBase64(new Uint8Array(encrypted)) },
  };
}

export function assertEmployeeAccessEnvelope(value: unknown): EmployeeAccessEnvelope {
  const envelope = asRecord(value, "Employee access package");
  const format = stringField(envelope, "format", "Employee access package format");
  const networkId = assertNetworkId(stringField(envelope, "networkId", "Employee access package network ID"));
  const contractAddress = assertContractAddress(stringField(envelope, "contractAddress", "Employee access package contract address"));
  const createdAt = stringField(envelope, "createdAt", "Employee access package creation time");
  const createdAtMs = assertIsoDate(createdAt, "Employee access package creation time");
  if (createdAtMs > Date.now() + MAX_CLOCK_SKEW_MS) throw new Error("Employee access package creation time is in the future");

  const kdf = asRecord(envelope.kdf, "Employee access package KDF");
  const cipher = asRecord(envelope.cipher, "Employee access package cipher");
  if (stringField(cipher, "name", "Employee access package cipher") !== "AES-GCM") {
    throw new Error("Employee access package uses unsupported encryption settings");
  }
  const cipherValue: EnvelopeCipher = {
    name: "AES-GCM",
    iv: stringField(cipher, "iv", "Employee access package IV"),
    ciphertext: stringField(cipher, "ciphertext", "Employee access package ciphertext"),
  };
  if (stringField(kdf, "name", "Employee access package KDF") !== "PBKDF2" || stringField(kdf, "hash", "Employee access package KDF hash") !== "SHA-256") {
    throw new Error("Employee access package uses unsupported key derivation settings");
  }
  const salt = stringField(kdf, "salt", "Employee access package KDF salt");
  const iterations = kdf.iterations;

  if (format === "blackpay-employee-access-envelope-v1") {
    if (iterations !== 250000) throw new Error("Employee access package uses unsupported legacy key derivation settings");
    return {
      format,
      networkId,
      contractAddress,
      createdAt,
      kdf: { name: "PBKDF2", hash: "SHA-256", iterations: 250000, salt },
      cipher: cipherValue,
    };
  }

  if (format === "blackpay-employee-access-envelope-v2") {
    if (iterations !== 600000) throw new Error("Employee access package uses unsupported key derivation settings");
    const packageId = stringField(envelope, "packageId", "Employee access package identifier").toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(packageId)) throw new Error("Employee access package has an invalid package identifier");
    const expiresAt = stringField(envelope, "expiresAt", "Employee access package expiry");
    const expiresAtMs = assertIsoDate(expiresAt, "Employee access package expiry");
    if (expiresAtMs <= createdAtMs || expiresAtMs - createdAtMs > PACKAGE_TTL_MS + MAX_CLOCK_SKEW_MS) {
      throw new Error("Employee access package has an invalid expiry window");
    }
    if (expiresAtMs <= Date.now()) throw new Error("Employee access package has expired. Ask the employer to export a fresh package.");
    return {
      format,
      networkId,
      contractAddress,
      packageId,
      createdAt,
      expiresAt,
      kdf: { name: "PBKDF2", hash: "SHA-256", iterations: 600000, salt },
      cipher: cipherValue,
    };
  }

  throw new Error("Unsupported employee access package format");
}

export async function decryptEmployeeAccessPayload(
  envelopeValue: unknown,
  password: string,
): Promise<{ envelope: EmployeeAccessEnvelope; payload: EmployeeAccessPayload }> {
  const envelope = assertEmployeeAccessEnvelope(envelopeValue);
  if (envelope.format === "blackpay-employee-access-envelope-v2") assertStrongPassword(password);
  else assertLegacyPassword(password);

  const salt = base64ToBytes(envelope.kdf.salt, "Employee access package KDF salt");
  const iv = base64ToBytes(envelope.cipher.iv, "Employee access package IV");
  const ciphertext = base64ToBytes(envelope.cipher.ciphertext, "Employee access package ciphertext");
  const expectedSaltLength = envelope.format === "blackpay-employee-access-envelope-v2" ? 32 : 16;
  if (salt.byteLength !== expectedSaltLength || iv.byteLength !== 12 || ciphertext.byteLength < 16 || ciphertext.byteLength > 1_100_000) {
    throw new Error("Employee access package cryptographic fields are invalid");
  }

  const key = await deriveKey(password, salt, envelope.kdf.iterations);
  let plaintext: ArrayBuffer;
  try {
    plaintext = await assertBrowserCrypto().subtle.decrypt(
      {
        name: "AES-GCM",
        iv: ownedArrayBuffer(iv),
        ...(envelope.format === "blackpay-employee-access-envelope-v2"
          ? { additionalData: ownedArrayBuffer(additionalData(envelope)) }
          : {}),
      },
      key,
      ownedArrayBuffer(ciphertext),
    );
  } catch {
    throw new Error("Employee access package could not be decrypted. Check the access password and file integrity.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(decoder.decode(plaintext));
  } catch {
    throw new Error("Employee access package decrypted to invalid JSON");
  }
  return {
    envelope,
    payload: assertPayload(parsed, envelope.format === "blackpay-employee-access-envelope-v2" ? envelope : undefined),
  };
}
