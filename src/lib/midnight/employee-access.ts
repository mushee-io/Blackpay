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

export type EmployeeAccessPayload = {
  version: "blackpay-employee-access-v1";
  employeeIdHex: string;
  salaryMinor: string;
  payoutCommitmentHex: string;
  saltHex: string;
  payslips: EmployeeAccessPayslipPayload[];
};

export type EmployeeAccessEnvelope = {
  format: "blackpay-employee-access-envelope-v1";
  networkId: string;
  contractAddress: string;
  createdAt: string;
  kdf: {
    name: "PBKDF2";
    hash: "SHA-256";
    iterations: 250000;
    salt: string;
  };
  cipher: {
    name: "AES-GCM";
    iv: string;
    ciphertext: string;
  };
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function assertBrowserCrypto(): Crypto {
  if (typeof crypto === "undefined" || !crypto.subtle || typeof crypto.getRandomValues !== "function") {
    throw new Error("Secure browser cryptography is required for employee access packages");
  }
  return crypto;
}

function assertPassword(password: string): void {
  if (password.length < 16) throw new Error("Employee access password must be at least 16 characters");
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((pattern) => pattern.test(password)).length;
  if (classes < 3) throw new Error("Employee access password must use at least three character types");
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  try {
    const binary = atob(value);
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    throw new Error("Employee access package contains invalid base64 data");
  }
}

function ownedArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const webCrypto = assertBrowserCrypto();
  const material = await webCrypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveKey"]);
  return webCrypto.subtle.deriveKey(
    { name: "PBKDF2", salt: ownedArrayBuffer(salt), iterations: 250000, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptEmployeeAccessPayload(params: {
  networkId: string;
  contractAddress: string;
  password: string;
  payload: EmployeeAccessPayload;
}): Promise<EmployeeAccessEnvelope> {
  assertPassword(params.password);
  if (!params.networkId.trim()) throw new Error("Employee access package requires a network ID");
  if (!params.contractAddress.trim()) throw new Error("Employee access package requires a contract address");

  const webCrypto = assertBrowserCrypto();
  const salt = webCrypto.getRandomValues(new Uint8Array(16));
  const iv = webCrypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(params.password, salt);
  const plaintext = encoder.encode(JSON.stringify(params.payload));
  if (plaintext.byteLength > 1_000_000) throw new Error("Employee access payload is unexpectedly large");
  const encrypted = await webCrypto.subtle.encrypt(
    { name: "AES-GCM", iv: ownedArrayBuffer(iv) },
    key,
    ownedArrayBuffer(plaintext),
  );

  return {
    format: "blackpay-employee-access-envelope-v1",
    networkId: params.networkId,
    contractAddress: params.contractAddress,
    createdAt: new Date().toISOString(),
    kdf: {
      name: "PBKDF2",
      hash: "SHA-256",
      iterations: 250000,
      salt: bytesToBase64(salt),
    },
    cipher: {
      name: "AES-GCM",
      iv: bytesToBase64(iv),
      ciphertext: bytesToBase64(new Uint8Array(encrypted)),
    },
  };
}

export function assertEmployeeAccessEnvelope(value: unknown): EmployeeAccessEnvelope {
  if (!value || typeof value !== "object") throw new Error("Employee access package is invalid");
  const envelope = value as Partial<EmployeeAccessEnvelope>;
  if (envelope.format !== "blackpay-employee-access-envelope-v1") throw new Error("Unsupported employee access package format");
  if (!envelope.networkId?.trim() || !envelope.contractAddress?.trim()) throw new Error("Employee access package metadata is incomplete");
  if (envelope.kdf?.name !== "PBKDF2" || envelope.kdf.hash !== "SHA-256" || envelope.kdf.iterations !== 250000) {
    throw new Error("Employee access package uses unsupported key derivation settings");
  }
  if (envelope.cipher?.name !== "AES-GCM" || !envelope.cipher.iv || !envelope.cipher.ciphertext) {
    throw new Error("Employee access package uses unsupported encryption settings");
  }
  return envelope as EmployeeAccessEnvelope;
}

function assertPayload(value: unknown): EmployeeAccessPayload {
  if (!value || typeof value !== "object") throw new Error("Decrypted employee access payload is invalid");
  const payload = value as Partial<EmployeeAccessPayload>;
  if (payload.version !== "blackpay-employee-access-v1") throw new Error("Unsupported employee access payload version");
  if (!payload.employeeIdHex?.match(/^[0-9a-f]{64}$/i)) throw new Error("Employee access payload has an invalid employee identifier");
  if (!payload.payoutCommitmentHex?.match(/^[0-9a-f]{64}$/i)) throw new Error("Employee access payload has an invalid payout commitment");
  if (!payload.saltHex?.match(/^[0-9a-f]{64}$/i)) throw new Error("Employee access payload has an invalid private salt");
  try {
    if (BigInt(payload.salaryMinor ?? "0") <= 0n) throw new Error();
  } catch {
    throw new Error("Employee access payload has an invalid salary");
  }
  if (!Array.isArray(payload.payslips) || payload.payslips.length > 500) throw new Error("Employee access payload has an invalid payslip collection");
  return payload as EmployeeAccessPayload;
}

export async function decryptEmployeeAccessPayload(
  envelopeValue: unknown,
  password: string,
): Promise<{ envelope: EmployeeAccessEnvelope; payload: EmployeeAccessPayload }> {
  assertPassword(password);
  const envelope = assertEmployeeAccessEnvelope(envelopeValue);
  const salt = base64ToBytes(envelope.kdf.salt);
  const iv = base64ToBytes(envelope.cipher.iv);
  const ciphertext = base64ToBytes(envelope.cipher.ciphertext);
  if (salt.byteLength !== 16 || iv.byteLength !== 12 || ciphertext.byteLength > 1_100_000) {
    throw new Error("Employee access package cryptographic fields are invalid");
  }

  const key = await deriveKey(password, salt);
  let plaintext: ArrayBuffer;
  try {
    plaintext = await assertBrowserCrypto().subtle.decrypt(
      { name: "AES-GCM", iv: ownedArrayBuffer(iv) },
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
  return { envelope, payload: assertPayload(parsed) };
}
