import { getAddressDecoder } from "@solana/kit";
import BigNumber from "bignumber.js";
import { describe, expect, it } from "vitest";

import {
  bigNumberToWrappedI80F48,
  composeRemainingAccounts,
  deriveBankLiquidityVault,
  deriveBankLiquidityVaultAuthority,
  deriveFeeState,
  deriveMarginfiAccount,
  uiToNative,
  wrappedI80F48toBigNumber,
} from "~/utils";

// Values match the pre-Kit web3.js / BN implementations (checked on random inputs during the
// migration); never update the snapshot with `-u`.

const key = (fill: number) => getAddressDecoder().decode(new Uint8Array(32).fill(fill));

describe("I80F48 conversion", () => {
  it.each(["0", "1", "-1", "0.5", "123.456", "-98765.4321"])("encodes %s", (value) => {
    const wrapped = bigNumberToWrappedI80F48(new BigNumber(value));
    expect(Array.from(wrapped.value)).toMatchSnapshot();
    expect(wrappedI80F48toBigNumber(wrapped).toNumber()).toBeCloseTo(Number(value), 6);
  });
});

describe("amounts", () => {
  it("converts UI amounts to native bigint, rounding down", () => {
    expect(uiToNative("1.23456789", 6)).toBe(1_234_567n);
    expect(uiToNative(new BigNumber(42), 9)).toBe(42_000_000_000n);
  });
});

describe("remaining accounts", () => {
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

describe("marginfi PDAs", () => {
  it("derives the recorded addresses", async () => {
    const program = key(200);
    expect({
      liquidityVaultAuthority: await deriveBankLiquidityVaultAuthority(program, key(4)),
      liquidityVault: await deriveBankLiquidityVault(program, key(4)),
      feeState: await deriveFeeState(program),
      marginfiAccount: await deriveMarginfiAccount(program, key(1), key(2), 3, 7),
    }).toMatchSnapshot();
  });
});
