import { BigNumber } from "bignumber.js";
import { describe, expect, it, vi } from "vitest";

import { makeBank } from "../../../helpers/factories";

import { computeLoopingParams, computeMaxLeverage } from "~/services/bank";

const deposit = makeBank({ mintDecimals: 9, config: { assetWeightInit: new BigNumber(0.8) } });
const borrow = makeBank({ mintDecimals: 6, config: { liabilityWeightInit: new BigNumber(1) } });

describe("computeMaxLeverage", () => {
  it("is 1 / (1 - LTV), the LTV being the asset weight over the liability weight", () => {
    const { ltv, maxLeverage } = computeMaxLeverage(deposit, borrow);
    expect(ltv).toBe(0.8);
    expect(maxLeverage).toBeCloseTo(5);
  });

  it("uses the given weights over the banks' own, e.g. emode weights", () => {
    const { ltv } = computeMaxLeverage(deposit, borrow, {
      assetWeightInit: new BigNumber(0.9),
      liabilityWeightInit: new BigNumber(1.125),
    });
    expect(ltv).toBe(0.8);
  });
});

describe("computeLoopingParams", () => {
  const loop = (leverage: number) => {
    const { totalDepositAmount, totalBorrowAmount } = computeLoopingParams(
      10,
      leverage,
      deposit,
      borrow,
      150,
      1
    );
    return { deposit: totalDepositAmount.toNumber(), borrow: totalBorrowAmount.toNumber() };
  };

  it("deposits principal × leverage and borrows the rest at the price ratio", () => {
    expect(loop(3)).toEqual({ deposit: 30, borrow: 3_000 });
  });

  it("clamps the leverage between 1x and the max", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(loop(0.5)).toEqual({ deposit: 10, borrow: 0 });
    expect(loop(8).deposit).toBeCloseTo(50);
  });

  it("rounds both amounts down to their mint's decimals", () => {
    const { totalDepositAmount, totalBorrowAmount } = computeLoopingParams(
      1,
      1.5,
      deposit,
      borrow,
      1,
      3
    );
    expect(totalDepositAmount.toNumber()).toBe(1.5);
    expect(totalBorrowAmount.toFixed()).toBe("0.166666");
  });
});
