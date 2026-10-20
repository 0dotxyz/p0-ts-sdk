import { SCOPE_MAX_ENTRIES } from "~/vendor/scope";

// sha256("account:OraclePrices")[..8]; 8 + 32 (oracle_mappings) + 512 × 56 (DatedPrice) bytes.
const SCOPE_ORACLE_PRICES_DISCRIMINATOR = [89, 128, 118, 221, 6, 72, 180, 146];
const ENTRIES_OFFSET = 40;
const DATED_PRICE_SIZE = 56;
export const SCOPE_ORACLE_PRICES_SIZE = ENTRIES_OFFSET + SCOPE_MAX_ENTRIES * DATED_PRICE_SIZE;

export function scopeAccountData(
  entries: { index: number; value: bigint; exp: bigint; slot: bigint; timestamp: bigint }[]
): Uint8Array {
  const data = new Uint8Array(SCOPE_ORACLE_PRICES_SIZE);
  data.set(SCOPE_ORACLE_PRICES_DISCRIMINATOR, 0);
  const view = new DataView(data.buffer);
  for (const entry of entries) {
    const offset = ENTRIES_OFFSET + entry.index * DATED_PRICE_SIZE;
    view.setBigUint64(offset, entry.value, true);
    view.setBigUint64(offset + 8, entry.exp, true);
    view.setBigUint64(offset + 16, entry.slot, true);
    view.setBigUint64(offset + 24, entry.timestamp, true);
  }
  return data;
}
