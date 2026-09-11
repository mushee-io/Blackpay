import { MidnightBech32m, ShieldedAddress } from "@midnight-ntwrk/wallet-sdk-address-format";

export function shieldedCoinPublicKeyHex(address: string, networkId: string): string {
  const normalized = address.trim();
  if (!normalized) throw new Error("Shielded payout address is required");
  try {
    const parsed = MidnightBech32m.parse(normalized);
    const decoded = parsed.decode(ShieldedAddress, networkId);
    const coinPublicKeyHex = decoded.coinPublicKeyString().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(coinPublicKeyHex)) {
      throw new Error("decoded coin public key is not 32 bytes");
    }
    return coinPublicKeyHex;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid ${networkId} Midnight shielded address: ${detail}`);
  }
}

export function assertTokenColorHex(tokenType: string): string {
  const normalized = tokenType.trim().toLowerCase().replace(/^0x/, "");
  if (!/^[0-9a-f]{64}$/.test(normalized)) {
    throw new Error("Payroll token type must be the 32-byte raw Midnight token type returned by Lace");
  }
  return normalized;
}
