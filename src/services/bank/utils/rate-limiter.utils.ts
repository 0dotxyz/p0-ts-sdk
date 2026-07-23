import { BigNumber } from "bignumber.js";

import { BankRateLimiterType, RateLimitWindowType } from "../types/bank.types";

/**
 * Client-side port of the on-chain sliding-window rate limiter math in
 * `marginfi-v2/programs/marginfi/src/state/rate_limiter.rs`.
 *
 * The on-chain program tracks *net* outflow ((withdraws + borrows) − (deposits + repays))
 * per window and rejects an outflow that would push the window past `maxOutflow`. This
 * helper reproduces `RateLimitWindow::effective_remaining_capacity` — the non-mutating
 * variant that simulates window advancement — so callers can predict whether an
 * instruction will trip the limiter before sending.
 *
 * All amounts are in the limiter's own denomination: **native tokens** for the per-bank
 * `BankRateLimiter`, USD for the group limiter (we only use the bank limiter here).
 *
 * A window with `maxOutflow == 0` is disabled; its remaining capacity is `null` (unlimited).
 */

/** A window is enabled iff it has a non-zero max outflow (mirrors `RateLimitWindowImpl::is_enabled`). */
export function isRateLimitWindowEnabled(window: RateLimitWindowType): boolean {
  return window.maxOutflow.gt(0);
}

/**
 * Simulate `maybe_advance_window` without mutating: returns the (windowStart, prevOutflow,
 * curOutflow) triple that would be in effect at `nowTs`. Mirrors `effective_window_state`.
 */
function effectiveWindowState(
  window: RateLimitWindowType,
  nowTs: number
): { windowStart: number; prevOutflow: BigNumber; curOutflow: BigNumber } {
  const { windowStart, windowDuration, prevWindowOutflow, curWindowOutflow } = window;

  if (!isRateLimitWindowEnabled(window) || windowDuration === 0) {
    return { windowStart, prevOutflow: prevWindowOutflow, curOutflow: curWindowOutflow };
  }

  const elapsed = nowTs - windowStart;
  if (elapsed < 0) {
    return { windowStart, prevOutflow: prevWindowOutflow, curOutflow: curWindowOutflow };
  }

  if (elapsed >= windowDuration * 2) {
    // More than two windows have passed → fully reset.
    return { windowStart: nowTs, prevOutflow: new BigNumber(0), curOutflow: new BigNumber(0) };
  }
  if (elapsed >= windowDuration) {
    // One window passed → current shifts into previous, current resets.
    return {
      windowStart: windowStart + windowDuration,
      prevOutflow: curWindowOutflow,
      curOutflow: new BigNumber(0),
    };
  }
  return { windowStart, prevOutflow: prevWindowOutflow, curOutflow: curWindowOutflow };
}

/**
 * Remaining outflow capacity for a single window at `nowTs`. `null` means the window is
 * disabled (unlimited). A negative result means the window is already over its cap.
 * Mirrors `remaining_capacity_from_state` composed with `effective_window_state`.
 */
export function computeWindowRemainingCapacity(
  window: RateLimitWindowType,
  nowTs: number
): BigNumber | null {
  if (!isRateLimitWindowEnabled(window)) return null;

  const { windowStart, prevOutflow, curOutflow } = effectiveWindowState(window, nowTs);
  const { maxOutflow, windowDuration } = window;

  if (windowDuration === 0) return maxOutflow;

  const elapsed = nowTs - windowStart;
  if (elapsed < 0) return new BigNumber(0);
  if (elapsed >= windowDuration) return maxOutflow;

  const remainingTime = windowDuration - elapsed;
  // Integer division truncated toward zero, matching the on-chain i128 arithmetic
  // (prevOutflow can be negative when the window has net inflows).
  const weightedPrev = prevOutflow
    .times(remainingTime)
    .dividedToIntegerBy(windowDuration);
  const totalNetOutflow = weightedPrev.plus(curOutflow);
  return maxOutflow.minus(totalNetOutflow);
}

export interface RateLimitCapacity {
  /** Remaining native capacity per window (`null` = window disabled/unlimited). */
  hourly: BigNumber | null;
  daily: BigNumber | null;
  /** The tighter of the enabled windows (`null` when both disabled). */
  combined: BigNumber | null;
  /** Which window is the binding constraint (`null` when the limiter is fully disabled). */
  bindingWindow: "hourly" | "daily" | null;
}

/**
 * Remaining outflow capacity of a bank/group rate limiter at `nowTs`, combining its hourly
 * and daily windows. `combined` is the tighter enabled window; `null` throughout means the
 * limiter is disabled and imposes no cap.
 */
export function computeRateLimitRemainingCapacity(
  limiter: BankRateLimiterType | undefined,
  nowTs: number
): RateLimitCapacity {
  if (!limiter) {
    return { hourly: null, daily: null, combined: null, bindingWindow: null };
  }

  const hourly = computeWindowRemainingCapacity(limiter.hourly, nowTs);
  const daily = computeWindowRemainingCapacity(limiter.daily, nowTs);

  let combined: BigNumber | null = null;
  let bindingWindow: "hourly" | "daily" | null = null;
  if (hourly !== null) {
    combined = hourly;
    bindingWindow = "hourly";
  }
  if (daily !== null && (combined === null || daily.lt(combined))) {
    combined = daily;
    bindingWindow = "daily";
  }

  return { hourly, daily, combined, bindingWindow };
}
