import { BigNumber } from "bignumber.js";
import { describe, expect, it } from "vitest";

import { key } from "../helpers/addresses";

import {
  bigNumberToWrappedI80F48,
  composeRemainingAccounts,
  maxSlippageU32ToPercent,
  percentToMaxSlippageU32,
  uiToNative,
  wrappedI80F48toBigNumber,
} from "~/utils";

// Values match the pre-Kit web3.js / BN implementations (checked on random inputs during the
// migration); never update the snapshot with `-u`.
describe("I80F48 conversion", () => {
  it.each(["0", "1", "-1", "0.5", "123.456", "-98765.4321"])("encodes %s", (value) => {
    const wrapped = bigNumberToWrappedI80F48(new BigNumber(value));
    expect(Array.from(wrapped.value)).toMatchSnapshot();
    expect(wrappedI80F48toBigNumber(wrapped).toNumber()).toBeCloseTo(Number(value), 6);
  });
});

describe("uiToNative", () => {
  it("converts UI amounts to native bigint, rounding down", () => {
    expect(uiToNative("1.23456789", 6)).toBe(1_234_567n);
    expect(uiToNative(new BigNumber(42), 9)).toBe(42_000_000_000n);
  });
});

describe("percentToMaxSlippageU32", () => {
  it("round-trips percent through the u32 fraction", () => {
    expect(maxSlippageU32ToPercent(percentToMaxSlippageU32(1))).toBeCloseTo(1, 6);
    expect(percentToMaxSlippageU32(10)).toBe(Math.floor(4294967295 / 10));
  });

  it("rejects values outside the protocol cap", () => {
    expect(() => percentToMaxSlippageU32(0)).toThrow();
    expect(() => percentToMaxSlippageU32(10.5)).toThrow();
  });
});

describe("composeRemainingAccounts", () => {
  it("orders bank groups by descending bank address bytes", () => {
    expect(composeRemainingAccounts([[key(1), key(9)], [key(3)], [key(2), key(8)]])).toEqual([
      key(3),
      key(2),
      key(8),
      key(1),
      key(9),
    ]);
  });
});
