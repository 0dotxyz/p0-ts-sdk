import { describe, it, expect } from "vitest";
import { BigNumber } from "bignumber.js";

import {
  computeRateLimitRemainingCapacity,
  computeWindowRemainingCapacity,
  isRateLimitWindowEnabled,
} from "~/services/bank";
import { RateLimitWindowType, BankRateLimiterType } from "~/services/bank/types/bank.types";

function window(overrides: Partial<RateLimitWindowType>): RateLimitWindowType {
  return {
    maxOutflow: new BigNumber(0),
    windowDuration: 3600,
    windowStart: 1000,
    prevWindowOutflow: new BigNumber(0),
    curWindowOutflow: new BigNumber(0),
    ...overrides,
  };
}

describe("computeWindowRemainingCapacity (port parity with rate_limiter.rs)", () => {
  it("returns null for a disabled window (maxOutflow == 0)", () => {
    const w = window({ maxOutflow: new BigNumber(0) });
    expect(isRateLimitWindowEnabled(w)).toBe(false);
    expect(computeWindowRemainingCapacity(w, 1000)).toBeNull();
  });

  it("returns full capacity for a fresh window with no outflow", () => {
    const w = window({ maxOutflow: new BigNumber(1000) });
    expect(computeWindowRemainingCapacity(w, 1000)!.toString()).toBe("1000");
  });

  it("subtracts current-window outflow", () => {
    const w = window({ maxOutflow: new BigNumber(1000), curWindowOutflow: new BigNumber(300) });
    expect(computeWindowRemainingCapacity(w, 1000)!.toString()).toBe("700");
  });

  it("linearly decays the previous window's outflow across the current window", () => {
    // prev=400, half the window elapsed → weighted_prev = 400 * 1800/3600 = 200 → remaining 800.
    const w = window({
      maxOutflow: new BigNumber(1000),
      prevWindowOutflow: new BigNumber(400),
      windowStart: 1000,
    });
    expect(computeWindowRemainingCapacity(w, 1000 + 1800)!.toString()).toBe("800");
  });

  it("shifts current into previous after one window has elapsed", () => {
    // After exactly one window: cur(300) becomes prev at the new window start, fully counted → 700.
    const w = window({
      maxOutflow: new BigNumber(1000),
      curWindowOutflow: new BigNumber(300),
      windowStart: 1000,
    });
    expect(computeWindowRemainingCapacity(w, 1000 + 3600)!.toString()).toBe("700");
  });

  it("fully resets after two windows have elapsed", () => {
    const w = window({
      maxOutflow: new BigNumber(1000),
      curWindowOutflow: new BigNumber(900),
      windowStart: 1000,
    });
    expect(computeWindowRemainingCapacity(w, 1000 + 7200)!.toString()).toBe("1000");
  });

  it("can report negative remaining when already over the cap", () => {
    const w = window({ maxOutflow: new BigNumber(100), curWindowOutflow: new BigNumber(150) });
    expect(computeWindowRemainingCapacity(w, 1000)!.toString()).toBe("-50");
  });
});

describe("computeRateLimitRemainingCapacity (bank limiter: hourly + daily)", () => {
  it("returns all-null when no limiter is present", () => {
    const cap = computeRateLimitRemainingCapacity(undefined, 1000);
    expect(cap.combined).toBeNull();
    expect(cap.bindingWindow).toBeNull();
  });

  it("returns all-null when both windows are disabled", () => {
    const limiter: BankRateLimiterType = { hourly: window({}), daily: window({}) };
    const cap = computeRateLimitRemainingCapacity(limiter, 1000);
    expect(cap.combined).toBeNull();
    expect(cap.bindingWindow).toBeNull();
  });

  it("uses the tighter of the two enabled windows", () => {
    const limiter: BankRateLimiterType = {
      hourly: window({ maxOutflow: new BigNumber(1000), curWindowOutflow: new BigNumber(300) }), // 700
      daily: window({ maxOutflow: new BigNumber(5000), curWindowOutflow: new BigNumber(100) }), // 4900
    };
    const cap = computeRateLimitRemainingCapacity(limiter, 1000);
    expect(cap.combined!.toString()).toBe("700");
    expect(cap.bindingWindow).toBe("hourly");
  });

  it("falls back to the daily window when only it is enabled", () => {
    const limiter: BankRateLimiterType = {
      hourly: window({ maxOutflow: new BigNumber(0) }),
      daily: window({ maxOutflow: new BigNumber(5000), curWindowOutflow: new BigNumber(1000) }), // 4000
    };
    const cap = computeRateLimitRemainingCapacity(limiter, 1000);
    expect(cap.combined!.toString()).toBe("4000");
    expect(cap.bindingWindow).toBe("daily");
  });
});
