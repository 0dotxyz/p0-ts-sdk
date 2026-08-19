import BigNumber from "bignumber.js";

import { nativeToUi } from "../../../utils/conversion.utils";
import { BankRateLimiterType, BankType, RateLimitWindowType } from "../types";

/**
 * Remaining outflow capacity of a single sliding rate-limit window at `nowSeconds`,
 * mirroring the on-chain `RateLimitWindow::effective_remaining_capacity` (read-only —
 * applies the pending window roll-over without mutating state).
 *
 * Units match the window: native tokens for bank-level limiters, USD for group-level.
 *
 * @returns Remaining capacity, or `null` when the window is disabled (`maxOutflow == 0`)
 */
export function computeRateLimitWindowRemainingCapacity(
  window: RateLimitWindowType,
  nowSeconds: number
): BigNumber | null {
  const { maxOutflow, windowDuration } = window;
  if (maxOutflow.lte(0)) return null;
  if (windowDuration === 0) return maxOutflow;

  // effective_window_state: roll windows forward without mutating
  let { windowStart, prevWindowOutflow, curWindowOutflow } = window;
  const elapsedRaw = Math.floor(nowSeconds) - windowStart;
  if (elapsedRaw >= windowDuration * 2) {
    windowStart = Math.floor(nowSeconds);
    prevWindowOutflow = new BigNumber(0);
    curWindowOutflow = new BigNumber(0);
  } else if (elapsedRaw >= windowDuration) {
    windowStart = windowStart + windowDuration;
    prevWindowOutflow = curWindowOutflow;
    curWindowOutflow = new BigNumber(0);
  }

  // remaining_capacity_from_state
  const elapsed = Math.floor(nowSeconds) - windowStart;
  if (elapsed < 0) return new BigNumber(0);
  if (elapsed >= windowDuration) return maxOutflow;

  const remainingTime = windowDuration - elapsed;
  const weightedPrev = prevWindowOutflow
    .abs()
    .times(remainingTime)
    .idiv(windowDuration)
    .times(prevWindowOutflow.isNegative() ? -1 : 1);

  const totalNetOutflow = weightedPrev.plus(curWindowOutflow);
  return maxOutflow.minus(totalNetOutflow);
}

/**
 * Remaining outflow capacity across both (hourly, daily) windows of a rate limiter:
 * the minimum of the enabled windows, in the limiter's native units.
 *
 * @returns Remaining capacity, or `null` when no window is enabled (no rate limiting)
 */
export function computeRateLimiterRemainingCapacity(
  rateLimiter: BankRateLimiterType | undefined,
  nowSeconds: number
): BigNumber | null {
  if (!rateLimiter) return null;
  const hourly = computeRateLimitWindowRemainingCapacity(rateLimiter.hourly, nowSeconds);
  const daily = computeRateLimitWindowRemainingCapacity(rateLimiter.daily, nowSeconds);
  if (hourly === null) return daily;
  if (daily === null) return hourly;
  return BigNumber.min(hourly, daily);
}

/**
 * Remaining bank-level rate-limit outflow capacity (withdraws + borrows) in UI units of the
 * bank's mint, clamped at 0.
 *
 * @returns Remaining capacity in UI units, or `null` when the bank has no rate limiter enabled
 */
export function computeBankRateLimitRemaining(
  bank: BankType,
  nowSeconds: number = Date.now() / 1000
): BigNumber | null {
  const remaining = computeRateLimiterRemainingCapacity(bank.rateLimiter, nowSeconds);
  if (remaining === null) return null;
  return BigNumber.max(0, nativeToUi(remaining, bank.mintDecimals));
}

/**
 * Remaining group-level rate-limit outflow capacity in USD, clamped at 0.
 *
 * @returns Remaining capacity in USD, or `null` when the group has no rate limiter enabled
 */
export function computeGroupRateLimitRemainingUsd(
  rateLimiter: BankRateLimiterType | undefined,
  nowSeconds: number = Date.now() / 1000
): BigNumber | null {
  const remaining = computeRateLimiterRemainingCapacity(rateLimiter, nowSeconds);
  if (remaining === null) return null;
  return BigNumber.max(0, remaining);
}
