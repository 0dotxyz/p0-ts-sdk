import { describe, it, expect } from "vitest";
import BigNumber from "bignumber.js";
import { PublicKey } from "@solana/web3.js";

import { computePtMultiplier } from "~/services/price";
import { ExponentVault } from "~/vendor/exponent";

/** Fully-backed vault: `sy_for_pt x rate = pt_supply`, so the redemption cap is exactly 1.0. */
function vault(overrides: Partial<ExponentVault> = {}): ExponentVault {
  return {
    authority: PublicKey.default,
    syProgram: PublicKey.default,
    mintSy: PublicKey.default,
    mintYt: PublicKey.default,
    mintPt: PublicKey.default,
    escrowSy: PublicKey.default,
    yieldPosition: PublicKey.default,
    addressLookupTable: PublicKey.default,
    cpiAccounts: { getSyState: [], depositSy: [], withdrawSy: [] },
    syForPt: 500_000_000_000n,
    ptSupply: 1_000_000_000_000n,
    lastSeenSyExchangeRate: new BigNumber(2),
    finalSyExchangeRate: new BigNumber(0),
    status: 0,
    startTs: 1_000,
    duration: 1_000,
    ...overrides,
  };
}

describe("computePtMultiplier", () => {
  const startPrice = new BigNumber(0.8);

  it("lerps from the start price to par over the vault term, clamped at both ends", () => {
    expect(computePtMultiplier(vault(), startPrice, 500).toNumber()).toBe(0.8);
    expect(computePtMultiplier(vault(), startPrice, 1_500).toNumber()).toBeCloseTo(0.9, 9);
    expect(computePtMultiplier(vault(), startPrice, 2_000).toNumber()).toBe(1);
    expect(computePtMultiplier(vault(), startPrice, 9_999).toNumber()).toBe(1);
  });

  it("caps at the redemption backing when the vault is under-backed", () => {
    // 0.4375 SY per PT x 2.0 = 0.875 cap; binds at maturity, inert at the midpoint (0.65 < 0.875)
    const underBacked = vault({ syForPt: 437_500_000_000n });
    const halfStart = new BigNumber(0.5);
    expect(computePtMultiplier(underBacked, halfStart, 2_000).toNumber()).toBe(0.875);
    expect(computePtMultiplier(underBacked, halfStart, 1_500).toNumber()).toBe(0.75);
  });

  it("throws on zero PT supply", () => {
    expect(() => computePtMultiplier(vault({ ptSupply: 0n }), startPrice, 1_500)).toThrow();
  });

  it("throws on malformed vaults the program rejects", () => {
    expect(() => computePtMultiplier(vault({ duration: 0 }), startPrice, 1_500)).toThrow();
    expect(() =>
      computePtMultiplier(vault({ lastSeenSyExchangeRate: new BigNumber(0) }), startPrice, 1_500)
    ).toThrow();
    // > u64::MAX / 1e12 means the raw rate overflowed a u64
    expect(() =>
      computePtMultiplier(vault({ lastSeenSyExchangeRate: new BigNumber(2e7) }), startPrice, 1_500)
    ).toThrow();
    // maturity more than ~5 years past `now`
    expect(() =>
      computePtMultiplier(
        vault({ startTs: 1_000, duration: 6 * 365 * 24 * 60 * 60 }),
        startPrice,
        1_000
      )
    ).toThrow();
  });
});
