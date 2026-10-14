import { afterEach, describe, expect, it, vi } from "vitest";

import { addr } from "../../helpers/addresses";

import {
  calculateJupLendBorrowRate,
  calculateJupLendLiquiditySupplyRate,
  calculateJupLendNewExchangePrice,
  calculateJupLendRewardsRate,
  calculateJupLendRewardsRateForExchangePrice,
  calculateJupLendSupplyRate,
  calculateJupLendTotalAssets,
  getJupLendFTokenMultiplier,
  JUP_MAX_REWARDS_RATE,
  JUP_SECONDS_PER_YEAR,
  type JupLendingRewardsRateModel,
  type JupLendingState,
  type JupRateModel,
  type JupTokenReserve,
} from "~/vendor/jup-lend";

const PRECISION = 1_000_000_000_000n;
const START = 1_700_000_000n;

const lendingState = (overrides: Partial<JupLendingState> = {}): JupLendingState => ({
  pubkey: addr(),
  mint: addr(),
  fTokenMint: addr(),
  lendingId: 1,
  decimals: 6,
  rewardsRateModel: addr(),
  liquidityExchangePrice: PRECISION,
  tokenExchangePrice: PRECISION,
  lastUpdateTimestamp: START,
  tokenReservesLiquidity: addr(),
  supplyPositionOnLiquidity: addr(),
  ...overrides,
});
const tokenReserve = (overrides: Partial<JupTokenReserve> = {}): JupTokenReserve => ({
  pubkey: addr(),
  borrowRate: 1_000,
  feeOnInterest: 1_000,
  lastUtilization: 5_000,
  supplyExchangePrice: PRECISION,
  borrowExchangePrice: PRECISION,
  totalSupplyWithInterest: 1_000n,
  totalSupplyInterestFree: 0n,
  totalBorrowWithInterest: 500n,
  totalBorrowInterestFree: 0n,
  ...overrides,
});
// 100 tokens a year for a year from START, from any TVL
const rewards = (
  overrides: Partial<JupLendingRewardsRateModel> = {}
): JupLendingRewardsRateModel => ({
  startTvl: 0n,
  duration: JUP_SECONDS_PER_YEAR,
  startTime: START,
  yearlyReward: 100n,
  ...overrides,
});

describe("calculateJupLendTotalAssets", () => {
  it("converts the fToken supply into underlying at the token exchange price", () => {
    const state = lendingState({ tokenExchangePrice: 1_050_000_000_000n });
    expect(calculateJupLendTotalAssets(state, 1_000n)).toBe(1_050n);
  });
});

describe("calculateJupLendRewardsRate", () => {
  const during = START + 10n;

  it("is the yearly reward over the market's assets, in bps", () => {
    expect(calculateJupLendRewardsRate(rewards(), 1_000n, during)).toMatchObject({
      rewardsRate: 1_000n,
      rewardsEnded: false,
    });
  });

  it("pays nothing without a schedule, below the start TVL, or after the run ends", () => {
    expect(
      calculateJupLendRewardsRate(rewards({ startTime: 0n }), 1_000n, during).rewardsRate
    ).toBe(0n);
    expect(calculateJupLendRewardsRate(rewards({ duration: 0n }), 1_000n, during).rewardsRate).toBe(
      0n
    );
    expect(
      calculateJupLendRewardsRate(rewards({ startTvl: 2_000n }), 1_000n, during).rewardsRate
    ).toBe(0n);
    expect(
      calculateJupLendRewardsRate(rewards(), 1_000n, START + JUP_SECONDS_PER_YEAR + 1n)
    ).toMatchObject({ rewardsRate: 0n, rewardsEnded: true });
  });
});

describe("calculateJupLendRewardsRateForExchangePrice", () => {
  const during = START + 10n;

  it("is the yearly reward over the market's assets at 1e12 precision", () => {
    expect(calculateJupLendRewardsRateForExchangePrice(rewards(), 1_000n, during).rate).toBe(
      100_000_000_000n
    );
  });

  it("caps the rate at JUP_MAX_REWARDS_RATE", () => {
    const generous = rewards({ yearlyReward: 1_000_000n });
    expect(calculateJupLendRewardsRateForExchangePrice(generous, 1n, during).rate).toBe(
      JUP_MAX_REWARDS_RATE
    );
  });
});

describe("calculateJupLendNewExchangePrice", () => {
  it("grows the token price by the liquidity layer's exchange price growth", () => {
    const reserve = tokenReserve({ supplyExchangePrice: 1_010_000_000_000n });
    expect(calculateJupLendNewExchangePrice(lendingState(), reserve, null, 1_000n, START)).toBe(
      1_010_000_000_000n
    );
  });

  it("adds the rewards accrued since the last update", () => {
    // 10% a year in rewards (100 a year on 1_000 of assets), over half a year
    const halfYear = START + JUP_SECONDS_PER_YEAR / 2n;
    expect(
      calculateJupLendNewExchangePrice(lendingState(), tokenReserve(), rewards(), 1_000n, halfYear)
    ).toBe(1_050_000_000_000n);
  });
});

describe("getJupLendFTokenMultiplier", () => {
  it("is the projected exchange price over its precision", () => {
    const reserve = tokenReserve({ supplyExchangePrice: 1_010_000_000_000n });
    expect(
      getJupLendFTokenMultiplier(lendingState(), reserve, null, 1_000n, Number(START)).toNumber()
    ).toBe(1.01);
  });
});

describe("calculateJupLendLiquiditySupplyRate", () => {
  it("is the borrow rate net of the fee, scaled by utilization", () => {
    // 10% borrow rate, 10% fee, half the supply borrowed
    expect(calculateJupLendLiquiditySupplyRate(tokenReserve())).toBe(450n);
  });

  it("is zero without supply", () => {
    expect(calculateJupLendLiquiditySupplyRate(tokenReserve({ totalSupplyWithInterest: 0n }))).toBe(
      0n
    );
  });
});

describe("calculateJupLendSupplyRate", () => {
  afterEach(() => vi.useRealTimers());

  it("adds the rewards rate to the liquidity supply rate, as a fraction", () => {
    vi.useFakeTimers();
    vi.setSystemTime(Number(START + 10n) * 1000);
    expect(calculateJupLendSupplyRate(lendingState(), tokenReserve(), rewards(), 1_000n)).toBe(
      0.145
    );
    expect(calculateJupLendSupplyRate(lendingState(), tokenReserve(), null, 1_000n)).toBe(0.045);
  });
});

describe("calculateJupLendBorrowRate", () => {
  const v1: JupRateModel = {
    version: 1,
    rateAtZero: 0,
    kink1Utilization: 8_000,
    rateAtKink1: 1_000,
    rateAtMax: 5_000,
    kink2Utilization: 0,
    rateAtKink2: 0,
  };
  const v2: JupRateModel = { ...v1, version: 2, kink2Utilization: 9_000, rateAtKink2: 2_000 };

  it("interpolates between zero, the kink and max for a version 1 model", () => {
    expect(calculateJupLendBorrowRate(v1, 4_000)).toBe(500);
    expect(calculateJupLendBorrowRate(v1, 8_000)).toBe(1_000);
    expect(calculateJupLendBorrowRate(v1, 9_000)).toBe(3_000);
  });

  it("interpolates across both kinks for a version 2 model", () => {
    expect(calculateJupLendBorrowRate(v2, 8_500)).toBe(1_500);
    expect(calculateJupLendBorrowRate(v2, 9_500)).toBe(3_500);
  });

  it("clamps utilization to 0–100%", () => {
    expect(calculateJupLendBorrowRate(v1, -10)).toBe(0);
    expect(calculateJupLendBorrowRate(v1, 12_000)).toBe(5_000);
  });
});
