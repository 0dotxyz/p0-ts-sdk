import { describe, it, expect } from "vitest";

import {
  decodeMarinadeState,
  MARINADE_STATE_DISCRIMINATOR,
  MARINADE_STATE_MIN_SIZE,
} from "~/vendor/marinade";

// The real mainnet State account (8szGkuLT...) is 2616 bytes; only the prefix through
// msol_price @512 is read.
const MAINNET_STATE_SIZE = 2616;

function marinadeStateData(msolPriceRaw: bigint, size = MAINNET_STATE_SIZE): Buffer {
  const data = Buffer.alloc(size);
  MARINADE_STATE_DISCRIMINATOR.copy(data, 0);
  if (size >= 520) data.writeBigUInt64LE(msolPriceRaw, 512);
  return data;
}

describe("decodeMarinadeState", () => {
  it("reads msol_price at offset 512 of the real-size account and scales by 2^32", () => {
    // Live mainnet value observed on-chain: msol_price = 6_028_935_980 -> ~1.40372 mSOL/SOL
    const state = decodeMarinadeState(marinadeStateData(6_028_935_980n));
    expect(state.msolPrice.toNumber()).toBeCloseTo(1.40372104, 6);
  });

  it("accepts the minimal 520-byte prefix", () => {
    const state = decodeMarinadeState(marinadeStateData(5_992_546_810n, MARINADE_STATE_MIN_SIZE));
    expect(state.msolPrice.toNumber()).toBeCloseTo(1.39524853, 6);
  });

  it("rejects undersized accounts", () => {
    expect(() =>
      decodeMarinadeState(marinadeStateData(5_992_546_810n).subarray(0, 519))
    ).toThrow();
  });

  it("rejects a wrong discriminator", () => {
    const data = marinadeStateData(5_992_546_810n);
    data[0] ^= 0xff;
    expect(() => decodeMarinadeState(data)).toThrow();
  });

  it("rejects out-of-bounds rates", () => {
    expect(() => decodeMarinadeState(marinadeStateData(0n))).toThrow();
    // 200 * 2^32 = rate exactly at the ceiling
    expect(() => decodeMarinadeState(marinadeStateData(200n * 2n ** 32n))).toThrow();
  });
});
