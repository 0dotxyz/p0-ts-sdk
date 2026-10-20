import { address, type Address } from "@solana/kit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  calculateRewardApy,
  getReserveRewardsApy,
  getRewardPerTimeUnitSecond,
  type KaminoFarmRewardInfo,
  type KaminoFarmState,
  type KaminoReserve,
} from "~/vendor/klend";

const NOW_SECONDS = 1_760_000_000;

const REWARD_MINT = address("So11111111111111111111111111111111111111112");
const NULL_MINT = address("11111111111111111111111111111111");

function reward(
  points: [tsStart: number, rewardPerTimeUnit: number][],
  decimals: { token?: number; rewardsPerSecond?: number } = {},
  mint: Address = REWARD_MINT
): KaminoFarmRewardInfo {
  return {
    token: {
      mint,
      decimals: BigInt(decimals.token ?? 0),
    },
    rewardsAvailable: 0n,
    rewardsPerSecondDecimals: decimals.rewardsPerSecond ?? 0,
    rewardScheduleCurve: {
      points: points.map(([tsStart, rate]) => ({
        tsStart: BigInt(tsStart),
        rewardPerTimeUnit: BigInt(rate),
      })),
    },
  };
}

describe("getRewardPerTimeUnitSecond", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW_SECONDS * 1000);
  });
  afterEach(() => vi.useRealTimers());

  it("uses the rate of the period containing now", () => {
    const schedule = reward([
      [1_700_000_000, 1],
      [1_750_000_000, 2],
      [1_800_000_000, 3],
    ]);
    expect(getRewardPerTimeUnitSecond(schedule).toNumber()).toBe(2);
  });

  it("uses the first rate before the schedule starts", () => {
    const schedule = reward([
      [1_800_000_000, 1],
      [1_900_000_000, 2],
    ]);
    expect(getRewardPerTimeUnitSecond(schedule).toNumber()).toBe(1);
  });

  it("compares timestamps as numbers, whatever their digit count", () => {
    const schedule = reward([
      [900_000_000, 1],
      [950_000_000, 2],
      [2_000_000_000, 3],
    ]);
    expect(getRewardPerTimeUnitSecond(schedule).toNumber()).toBe(2);
  });

  it("scales the rate down by the reward token and rewards-per-second decimals", () => {
    const schedule = reward(
      [
        [1_700_000_000, 5_000_000],
        [1_800_000_000, 0],
      ],
      { token: 3, rewardsPerSecond: 3 }
    );
    expect(getRewardPerTimeUnitSecond(schedule).toNumber()).toBe(5);
  });
});

describe("calculateRewardApy", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW_SECONDS * 1000);
  });
  afterEach(() => vi.useRealTimers());

  // 1_000 tokens supplied at $1; one reward token a second at $0.00001
  const reserveMint = address("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
  const reserve = {
    liquidity: {
      mintPubkey: reserveMint,
      mintDecimals: 6n,
      totalAvailableAmount: 1_000_000_000n,
      borrowedAmountSf: 0n,
      accumulatedProtocolFeesSf: 0n,
      accumulatedReferrerFeesSf: 0n,
      pendingReferrerFeesSf: 0n,
    },
  } as unknown as KaminoReserve;
  const prices = { [reserveMint]: 1, [REWARD_MINT]: 0.00001 };
  const schedule = reward([
    [1_700_000_000, 1],
    [1_800_000_000, 0],
  ]);

  it("is a year of rewards at their price over the reserve's supply value", () => {
    const { apr, apy } = calculateRewardApy(prices, reserve, schedule);
    expect(apr.toNumber()).toBeCloseTo(0.31536);
    expect(apy.toNumber()).toBeCloseTo(0.31536);
  });

  it("leaves out unset rewards and rewards without a price", async () => {
    const unpriced = reward(
      [[1_700_000_000, 1]],
      {},
      address("JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN")
    );
    const farm = {
      rewardInfos: [schedule, reward([[1_700_000_000, 1]], {}, NULL_MINT), unpriced],
    } as unknown as KaminoFarmState;

    const apys = await getReserveRewardsApy(prices, farm, reserve);

    expect(apys.map(({ rewardInfo }) => rewardInfo.token.mint)).toEqual([REWARD_MINT]);
  });
});
