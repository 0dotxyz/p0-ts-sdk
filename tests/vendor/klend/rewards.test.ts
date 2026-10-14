import { address } from "@solana/kit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getRewardPerTimeUnitSecond, type KaminoFarmRewardInfo } from "~/vendor/klend";

const NOW_SECONDS = 1_760_000_000;

function reward(
  points: [tsStart: number, rewardPerTimeUnit: number][],
  decimals: { token?: number; rewardsPerSecond?: number } = {}
): KaminoFarmRewardInfo {
  return {
    token: {
      mint: address("So11111111111111111111111111111111111111112"),
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
