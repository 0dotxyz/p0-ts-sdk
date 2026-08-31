import { describe, it, expect } from "vitest";

import { decodeMarinadeState, MARINADE_STATE_SIZE } from "~/vendor/marinade";

describe("decodeMarinadeState", () => {
  it("reads msol_price at offset 512 and scales by 2^32", () => {
    const data = Buffer.alloc(MARINADE_STATE_SIZE);
    // Live mainnet value observed on-chain: msol_price = 5_992_546_810 -> ~1.39524853 mSOL/SOL
    data.writeBigUInt64LE(5_992_546_810n, 512);

    const state = decodeMarinadeState(data);
    expect(state.msolPrice.toNumber()).toBeCloseTo(1.39524853, 6);
  });

  it("rejects a wrong account size", () => {
    expect(() => decodeMarinadeState(Buffer.alloc(MARINADE_STATE_SIZE - 1))).toThrow();
    expect(() => decodeMarinadeState(Buffer.alloc(MARINADE_STATE_SIZE + 1))).toThrow();
  });
});
