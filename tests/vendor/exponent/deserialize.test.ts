import BN from "bn.js";
import { describe, it, expect } from "vitest";

import { exponentNumberToBigNumber } from "~/vendor/exponent";

// Exponent's `Number` is a little-endian U256 (`[u64; 4]`) scaled by 1e12.
const DENOM = 1e12;

describe("exponentNumberToBigNumber", () => {
  it("decodes ONE (1e12) as 1", () => {
    expect(
      exponentNumberToBigNumber([new BN(DENOM), new BN(0), new BN(0), new BN(0)]).toString()
    ).toBe("1");
  });

  it("scales the low word by 1e12", () => {
    expect(
      exponentNumberToBigNumber([new BN(5 * DENOM), new BN(0), new BN(0), new BN(0)]).toString()
    ).toBe("5");
  });

  it("treats the words as little-endian (word[1] = ×2^64)", () => {
    // word[1] = 1e12 → 1e12 * 2^64, /1e12 = 2^64 exactly.
    expect(
      exponentNumberToBigNumber([new BN(0), new BN(DENOM), new BN(0), new BN(0)]).toString()
    ).toBe("18446744073709551616");
  });

  it("unwraps the tuple-struct object shape ({ 0: [...] })", () => {
    expect(
      exponentNumberToBigNumber({ 0: [new BN(DENOM), new BN(0), new BN(0), new BN(0)] }).toString()
    ).toBe("1");
  });

  it("accepts plain numbers as words", () => {
    expect(exponentNumberToBigNumber([DENOM, 0, 0, 0]).toString()).toBe("1");
  });

  it("throws on an unexpected shape", () => {
    expect(() => exponentNumberToBigNumber(42)).toThrow();
  });
});
