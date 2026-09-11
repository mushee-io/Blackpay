import {
  MidnightBech32m,
  ShieldedAddress,
} from "@midnight-ntwrk/wallet-sdk-address-format";

function hex32(value: string, label: string): string {
  const normalized = value.toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalized)) throw new Error(`${label} is not 32 bytes`);
  return normalized;
}

export function shieldedCoinPublicKeyHex(address: string, networkId: string): string {
  const normalized = address.trim();
  if (!normalized) throw new Error("Shielded payout address is required");
  try {
    const parsed = MidnightBech32m.parse(normalized);
    const decoded = parsed.decode(ShieldedAddress, networkId);
    return hex32(decoded.coinPublicKeyString(), "Decoded shielded coin public key");
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid ${networkId} Midnight shielded address: ${detail}`);
  }
}

/**
 * Lace may expose the shielded coin public key either as raw 32-byte hex or
 * as the dedicated mn_shield-cpk_<network> Bech32m form. ShieldedCoinPublicKey
 * intentionally does not expose the generic HasCodec static hook in the
 * ledger-8 address-format package, so validate the parsed envelope directly
 * and read its canonical 32-byte payload instead of forcing decode().
 */
export function connectedShieldedCoinPublicKeyHex(value: string, networkId: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error("Connected wallet returned no shielded coin public key");
  if (/^[0-9a-f]{64}$/i.test(normalized)) return normalized.toLowerCase();
  try {
    const parsed = MidnightBech32m.parse(normalized);
    if (parsed.type !== "shield-cpk") throw new Error(`expected shield-cpk, got ${parsed.type}`);
    if (typeof parsed.network !== "string" || parsed.network !== networkId) {
      throw new Error(`expected ${networkId} shielded coin public key`);
    }
    return hex32(parsed.data.toString("hex"), "Connected shielded coin public key");
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid ${networkId} shielded coin public key from Lace: ${detail}`);
  }
}

export function assertTokenColorHex(tokenType: string): string {
  const normalized = tokenType.trim().toLowerCase().replace(/^0x/, "");
  if (!/^[0-9a-f]{64}$/.test(normalized)) {
    throw new Error("Payroll token type must be the 32-byte raw Midnight token type returned by Lace");
  }
  return normalized;
}
