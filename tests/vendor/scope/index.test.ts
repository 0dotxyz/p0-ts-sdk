import { describe, it, expect } from "vitest";

import { decodeScopePriceAtIndex, SCOPE_MAX_ENTRIES } from "~/vendor/scope";

// sha256("account:OraclePrices")[..8]; 8 + 32 (oracle_mappings) + 512 × 56 (DatedPrice) bytes.
const SCOPE_ORACLE_PRICES_DISCRIMINATOR = [89, 128, 118, 221, 6, 72, 180, 146];
const ENTRIES_OFFSET = 40;
const DATED_PRICE_SIZE = 56;
const SCOPE_ORACLE_PRICES_SIZE = ENTRIES_OFFSET + SCOPE_MAX_ENTRIES * DATED_PRICE_SIZE;

function scopeAccountData(
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

describe("decodeScopePriceAtIndex", () => {
  it("reads the configured entry as value / 10^exp", () => {
    const data = scopeAccountData([
      { index: 13, value: 10_344_510_800n, exp: 8n, slot: 123n, timestamp: 1_700_000_000n },
    ]);

    const entry = decodeScopePriceAtIndex(data, 13);
    expect(entry.price.toNumber()).toBeCloseTo(103.445108, 9);
    expect(entry.lastUpdatedSlot).toBe(123);
    expect(entry.unixTimestamp).toBe(1_700_000_000);
  });

  it("reads a never-refreshed entry as zero", () => {
    const data = scopeAccountData([]);
    const entry = decodeScopePriceAtIndex(data, 0);
    expect(entry.price.isZero()).toBe(true);
    expect(entry.unixTimestamp).toBe(0);
  });

  it("rejects an exponent past the program's power-of-ten table", () => {
    const data = scopeAccountData([
      { index: 7, value: 1_000n, exp: 24n, slot: 1n, timestamp: 500n },
    ]);
    expect(() => decodeScopePriceAtIndex(data, 7)).toThrow();
  });

  it("rejects out-of-range indices", () => {
    const data = scopeAccountData([]);
    expect(() => decodeScopePriceAtIndex(data, -1)).toThrow();
    expect(() => decodeScopePriceAtIndex(data, SCOPE_MAX_ENTRIES)).toThrow();
  });

  it("rejects a wrong discriminator and a wrong account size", () => {
    const badDisc = scopeAccountData([]);
    badDisc[0] ^= 0xff;
    expect(() => decodeScopePriceAtIndex(badDisc, 0)).toThrow();

    const short = scopeAccountData([]).subarray(0, SCOPE_ORACLE_PRICES_SIZE - 1);
    expect(() => decodeScopePriceAtIndex(short, 0)).toThrow();
  });
});
