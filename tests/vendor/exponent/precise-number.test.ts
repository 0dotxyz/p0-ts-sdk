import { describe, expect, it } from "vitest";

import { exponentNumberToBigNumber } from "~/vendor/exponent";

// Exponent's `PreciseNumber` is a little-endian U256 (`[u64; 4]`) scaled by 1e12.
const ONE = 1_000_000_000_000n;

describe("exponentNumberToBigNumber", () => {
  it("decodes ONE (1e12) as 1", () => {
    expect(exponentNumberToBigNumber([[ONE, 0n, 0n, 0n]]).toString()).toBe("1");
  });

  it("scales the low word by 1e12", () => {
    expect(exponentNumberToBigNumber([[5n * ONE, 0n, 0n, 0n]]).toString()).toBe("5");
  });

  it("treats the words as little-endian (word[1] = ×2^64)", () => {
    expect(exponentNumberToBigNumber([[0n, ONE, 0n, 0n]]).toString()).toBe("18446744073709551616");
  });

  it("keeps sub-unit precision", () => {
    expect(exponentNumberToBigNumber([[1_234_567_890_123n, 0n, 0n, 0n]]).toString()).toBe(
      "1.234567890123"
    );
  });
});
