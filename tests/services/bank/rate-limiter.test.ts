import { describe, it, expect } from "vitest";
import BigNumber from "bignumber.js";

import {
  computeRateLimitWindowRemainingCapacity,
  computeRateLimiterRemainingCapacity,
  RateLimitWindowType,
} from "~/services/bank";

const window = (o: Partial<RateLimitWindowType>): RateLimitWindowType => ({
  maxOutflow: new BigNumber(1000),
  windowDuration: 3600,
  windowStart: 10_000,
  prevWindowOutflow: new BigNumber(0),
  curWindowOutflow: new BigNumber(0),
  ...o,
});

const rem = (w: RateLimitWindowType, now: number) =>
  computeRateLimitWindowRemainingCapacity(w, now)?.toNumber() ?? null;

// Mirrors program `RateLimitWindow::effective_remaining_capacity`
describe("computeRateLimitWindowRemainingCapacity", () => {
  it("returns null when disabled (maxOutflow = 0)", () => {
    expect(rem(window({ maxOutflow: new BigNumber(0) }), 10_100)).toBeNull();
  });

  it("returns maxOutflow when windowDuration is 0", () => {
    expect(rem(window({ windowDuration: 0 }), 10_100)).toBe(1000);
  });

  it("subtracts current-window outflow inside the window", () => {
    expect(rem(window({ curWindowOutflow: new BigNumber(300) }), 10_100)).toBe(700);
  });

  it("weights previous-window outflow by remaining time fraction", () => {
    // elapsed 900s of 3600 → remaining 2700 → weight 0.75 → 400*0.75 = 300; +100 cur → 600 left
    const w = window({
      prevWindowOutflow: new BigNumber(400),
      curWindowOutflow: new BigNumber(100),
    });
    expect(rem(w, 10_900)).toBe(600);
  });

  it("negative previous outflow (net inflow) adds capacity", () => {
    // weight 0.75 → -300 → remaining 1300
    expect(rem(window({ prevWindowOutflow: new BigNumber(-400) }), 10_900)).toBe(1300);
  });

  it("can go negative when current outflow exceeds max (caller clamps)", () => {
    expect(rem(window({ curWindowOutflow: new BigNumber(1200) }), 10_100)).toBe(-200);
  });

  it("rolls one window forward: cur becomes prev, weighted", () => {
    // elapsed 4500 → effective windowStart 13600, prev=800, cur=0; elapsed 900 → weight 0.75 → 600 used
    const w = window({
      prevWindowOutflow: new BigNumber(999),
      curWindowOutflow: new BigNumber(800),
    });
    expect(rem(w, 14_500)).toBe(400);
  });

  it("resets completely after two windows", () => {
    const w = window({
      prevWindowOutflow: new BigNumber(999),
      curWindowOutflow: new BigNumber(999),
    });
    expect(rem(w, 17_200)).toBe(1000);
  });

  it("returns 0 when now is before windowStart", () => {
    expect(rem(window({}), 9_000)).toBe(0);
  });
});

describe("computeRateLimiterRemainingCapacity", () => {
  const off = window({ maxOutflow: new BigNumber(0) });

  it("null when no limiter / none enabled", () => {
    expect(computeRateLimiterRemainingCapacity(undefined, 0)).toBeNull();
    expect(computeRateLimiterRemainingCapacity({ hourly: off, daily: off }, 10_100)).toBeNull();
  });

  it("takes the min of enabled windows, ignoring disabled ones", () => {
    const hourly = window({ curWindowOutflow: new BigNumber(900) }); // 100 left
    const daily = window({ maxOutflow: new BigNumber(5000), windowDuration: 86400 }); // 5000 left
    expect(computeRateLimiterRemainingCapacity({ hourly, daily }, 10_100)!.toNumber()).toBe(100);
    expect(computeRateLimiterRemainingCapacity({ hourly: off, daily }, 10_100)!.toNumber()).toBe(
      5000
    );
  });
});
