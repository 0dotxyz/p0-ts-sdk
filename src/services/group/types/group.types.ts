import type { Address } from "@solana/kit";
import { BigNumber } from "bignumber.js";

import { BankConfigOpt, BankRateLimiterDto, BankRateLimiterType } from "~/services/bank/types";

/**
 * One pair of the group's premium table: the extra borrow APR for debt in `liabilityTag` banks
 * backed by `collateralTag` collateral.
 */
export type PremiumEntry = {
  collateralTag: number;
  liabilityTag: number;
  /** APR fraction (0.05 = 5%) */
  rate: BigNumber;
};

export type MarginfiGroupType = {
  admin: Address;
  address: Address;
  /**
   * Group-level net-outflow rate limiter (windows denominated in USD, unlike bank
   * rate limiters which use native tokens). When any window is enabled, every
   * withdraw/borrow requires a fresh oracle for the affected bank in remaining
   * accounts — see {@link isGroupRateLimiterEnabled}.
   */
  rateLimiter?: BankRateLimiterType;
  /** Live entries of the variable borrow premium table; empty when the group has no premium configured */
  premiumEntries: PremiumEntry[];
};

export type MarginfiGroupTypeDto = {
  admin: string;
  address: string;
  rateLimiter?: BankRateLimiterDto;
  premiumEntries?: { collateralTag: number; liabilityTag: number; rate: string }[];
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

/** The `BankConfigOpt` fields `lending_pool_add_bank` requires, all set. */
export type AddBankConfig = {
  [K in
    | "assetWeightInit"
    | "assetWeightMaint"
    | "liabilityWeightInit"
    | "liabilityWeightMaint"
    | "depositLimit"
    | "borrowLimit"
    | "operationalState"
    | "interestRateConfig"
    | "riskTier"
    | "assetTag"
    | "totalAssetValueInitLimit"
    | "oracleMaxConfidence"
    | "oracleMaxAge"]: NonNullable<BankConfigOpt[K]>;
};
