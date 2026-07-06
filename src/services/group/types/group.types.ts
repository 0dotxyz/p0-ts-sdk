import { PublicKey } from "@solana/web3.js";

import { BankRateLimiterType, BankRateLimiterDto } from "~/services/bank";

export type MarginfiGroupType = {
  admin: PublicKey;
  address: PublicKey;
  /**
   * Group-level net-outflow rate limiter (windows denominated in USD, unlike bank
   * rate limiters which use native tokens). When any window is enabled, every
   * withdraw/borrow requires a fresh oracle for the affected bank in remaining
   * accounts — see {@link isGroupRateLimiterEnabled}.
   */
  rateLimiter?: BankRateLimiterType;
};

export type MarginfiGroupTypeDto = {
  admin: string;
  address: string;
  rateLimiter?: BankRateLimiterDto;
};

/**
 * Mirrors the on-chain `GroupRateLimiter::is_enabled()`: true when any window has a
 * non-zero max outflow. While enabled, withdraws (including withdraw-all) and borrows
 * need the affected bank's oracle present and non-stale in remaining accounts.
 */
export function isGroupRateLimiterEnabled(rateLimiter?: BankRateLimiterType): boolean {
  if (!rateLimiter) return false;
  return rateLimiter.hourly.maxOutflow.gt(0) || rateLimiter.daily.maxOutflow.gt(0);
}
