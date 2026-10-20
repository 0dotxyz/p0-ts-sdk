import { describe, it, expect } from "vitest";

import { SCOPE_ORACLE_PRICES_SIZE, scopeAccountData } from "../../helpers/scope";

import { decodeScopePriceAtIndex, SCOPE_MAX_ENTRIES } from "~/vendor/scope";

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
    expect(() => decodeScopePriceAtIndex(data, 7)).toThrow("exponent out of bounds: 24");
  });

  it("rejects out-of-range indices", () => {
    const data = scopeAccountData([]);
    expect(() => decodeScopePriceAtIndex(data, -1)).toThrow("index out of range: -1");
    expect(() => decodeScopePriceAtIndex(data, SCOPE_MAX_ENTRIES)).toThrow("index out of range");
  });

  it("rejects a wrong discriminator and a wrong account size", () => {
    const badDisc = scopeAccountData([]);
    badDisc[0] ^= 0xff;
    expect(() => decodeScopePriceAtIndex(badDisc, 0)).toThrow("discriminator");

    const short = scopeAccountData([]).subarray(0, SCOPE_ORACLE_PRICES_SIZE - 1);
    expect(() => decodeScopePriceAtIndex(short, 0)).toThrow("account size");
  });
});
