import {
  JupLendingState,
  JupLendingRewardsRateModel,
  JupTokenReserve,
  JupRateModel,
} from "./types";

import { aprToApy } from "~/utils";

/**
 * Jup-Lend Interest Rate & Exchange Price Utilities
 *
 * Extracted from the compiled @jup-ag/lend SDK (earn/index.mjs).
 * All functions work on pre-fetched state — no RPC calls.
 *
 * Diverges from @jup-ag/lend 0.3.0-beta.1 `getNewExchangePrice`, which neither scales the rewards
 * term by 100 (1e12 → 1e14) nor zeroes rewards that haven't started or have ended; kept as-is
 * pending confirmation against the on-chain program.
 */

// ============================================================================
// CONSTANTS
// ============================================================================

export const JUP_EXCHANGE_PRICES_PRECISION = 1_000_000_000_000n; // 1e12
export const JUP_SECONDS_PER_YEAR = 31_536_000n;
export const JUP_MAX_REWARDS_RATE = 50_000_000_000_000n; // 50 * 1e12 = 50%

// ============================================================================
// TOTAL ASSETS
// ============================================================================

/**
 * Calculate total assets for a jup-lend market.
 * Formula: tokenExchangePrice * fTokenTotalSupply / EXCHANGE_PRICES_PRECISION
 *
 * @param lendingState - The on-chain Lending account
 * @param fTokenTotalSupply - Total supply of the fToken (from getTokenSupply)
 * @returns Total assets in underlying token native units
 */
export function calculateJupLendTotalAssets(
  lendingState: JupLendingState,
  fTokenTotalSupply: bigint
): bigint {
  return (lendingState.tokenExchangePrice * fTokenTotalSupply) / JUP_EXCHANGE_PRICES_PRECISION;
}

// ============================================================================
// REWARDS RATE
// ============================================================================

export interface JupLendRewardsResult {
  rewardsRate: bigint;
  rewardsEnded: boolean;
  rewardsStartTime: bigint;
}

/**
 * Calculate the rewards rate from a LendingRewardsRateModel.
 * Extracted from compiled SDK's `calculateRewardsRate`.
 *
 * @param rewardsModel - The on-chain LendingRewardsRateModel account
 * @param totalAssets - Total assets in the market (from calculateJupLendTotalAssets)
 * @param currentTimestamp - Current unix timestamp (seconds)
 * @returns Rewards rate, whether rewards ended, and start time
 */
export function calculateJupLendRewardsRate(
  rewardsModel: JupLendingRewardsRateModel,
  totalAssets: bigint,
  currentTimestamp: bigint
): JupLendRewardsResult {
  const defaultResult: JupLendRewardsResult = {
    rewardsRate: 0n,
    rewardsEnded: false,
    rewardsStartTime: rewardsModel.startTime,
  };

  if (rewardsModel.startTime === 0n || rewardsModel.duration === 0n) {
    return defaultResult;
  }

  if (currentTimestamp > rewardsModel.startTime + rewardsModel.duration) {
    return { ...defaultResult, rewardsEnded: true };
  }

  if (totalAssets < rewardsModel.startTvl) {
    return defaultResult;
  }

  let rewardsRate = (rewardsModel.yearlyReward * 10_000n) / totalAssets;

  if (rewardsRate > JUP_MAX_REWARDS_RATE) {
    rewardsRate = JUP_MAX_REWARDS_RATE;
  }

  return {
    rewardsRate,
    rewardsEnded: false,
    rewardsStartTime: rewardsModel.startTime,
  };
}

// ============================================================================
// REWARDS RATE FOR EXCHANGE PRICE (1e12 precision)
// ============================================================================

/**
 * Calculate the rewards rate at 1e12 precision for use in exchange price projection.
 * Mirrors SDK's `getRewardsRate` (earn/index.mjs line 261), NOT `calculateRewardsRate`.
 *
 * This is distinct from `calculateJupLendRewardsRate` which uses 1e4 precision for APR display.
 *
 * @param rewardsModel - The on-chain LendingRewardsRateModel account
 * @param totalAssets - Total assets in the market (from calculateJupLendTotalAssets)
 * @param currentTimestamp - Current unix timestamp (seconds)
 * @returns Rate at 1e12 precision and rewards start time
 */
export function calculateJupLendRewardsRateForExchangePrice(
  rewardsModel: JupLendingRewardsRateModel,
  totalAssets: bigint,
  currentTimestamp: bigint
): { rate: bigint; rewardsStartTime: bigint } {
  const defaultResult = { rate: 0n, rewardsStartTime: rewardsModel.startTime };

  if (rewardsModel.startTime === 0n || rewardsModel.duration === 0n) {
    return defaultResult;
  }

  if (currentTimestamp > rewardsModel.startTime + rewardsModel.duration) {
    return defaultResult;
  }

  if (totalAssets < rewardsModel.startTvl) {
    return defaultResult;
  }

  let rate = (rewardsModel.yearlyReward * JUP_EXCHANGE_PRICES_PRECISION) / totalAssets;

  if (rate > JUP_MAX_REWARDS_RATE) {
    rate = JUP_MAX_REWARDS_RATE;
  }

  return { rate, rewardsStartTime: rewardsModel.startTime };
}

// ============================================================================
// EXCHANGE PRICE PROJECTION
// ============================================================================

/**
 * Project the new token exchange price offline (no RPC calls).
 * Extracted from compiled SDK's `getNewExchangePrice` (earn/index.mjs line 316).
 *
 * This combines:
 * 1. Rewards rate contribution (time-weighted, 1e12 precision via getRewardsRate)
 * 2. Liquidity exchange price delta (scaled to 1e14)
 *
 * Both components are accumulated in 1e14 space before being applied.
 *
 * @param lendingState - The on-chain Lending account
 * @param tokenReserve - The on-chain TokenReserve account (provides current supplyExchangePrice)
 * @param rewardsModel - The on-chain LendingRewardsRateModel (or null if no rewards)
 * @param fTokenTotalSupply - Total supply of the fToken (for totalAssets calculation)
 * @param currentTimestamp - Current unix timestamp (seconds)
 * @returns Projected token exchange price (1e12 precision)
 */
export function calculateJupLendNewExchangePrice(
  lendingState: JupLendingState,
  tokenReserve: JupTokenReserve,
  rewardsModel: JupLendingRewardsRateModel | null,
  fTokenTotalSupply: bigint,
  currentTimestamp: bigint
): bigint {
  const oldTokenExchangePrice = lendingState.tokenExchangePrice;
  const oldLiquidityExchangePrice = lendingState.liquidityExchangePrice;
  const currentLiquidityExchangePrice = tokenReserve.supplyExchangePrice;

  // Rewards component — must use 1e12-precision rate (mirrors SDK getRewardsRate, not calculateRewardsRate)
  let rewardsRate = 0n;
  let rewardsStartTime = lendingState.lastUpdateTimestamp;

  if (rewardsModel) {
    const totalAssets = calculateJupLendTotalAssets(lendingState, fTokenTotalSupply);
    const result = calculateJupLendRewardsRateForExchangePrice(
      rewardsModel,
      totalAssets,
      currentTimestamp
    );
    rewardsRate = result.rate;
    rewardsStartTime = result.rewardsStartTime;
  }

  let lastUpdateTime = lendingState.lastUpdateTimestamp;
  if (lastUpdateTime < rewardsStartTime) {
    lastUpdateTime = rewardsStartTime;
  }

  const secondsElapsed = currentTimestamp - lastUpdateTime;

  // Rewards contribution: rate (1e12) * secondsElapsed / SECONDS_PER_YEAR → ~1e12 scale
  // Scaled up to 1e14 to match the liquidity delta component
  let totalReturnPercent = ((rewardsRate * secondsElapsed) / JUP_SECONDS_PER_YEAR) * 100n; // 1e12 → 1e14

  // Liquidity exchange price delta contribution (1e14 precision)
  const delta = currentLiquidityExchangePrice - oldLiquidityExchangePrice;
  totalReturnPercent += (delta * 100_000_000_000_000n) / oldLiquidityExchangePrice;

  return (
    oldTokenExchangePrice + (oldTokenExchangePrice * totalReturnPercent) / 100_000_000_000_000n
  );
}

// ============================================================================
// LIQUIDITY SUPPLY RATE
// ============================================================================

/**
 * Calculate the liquidity layer supply rate for an asset.
 * Extracted from compiled SDK's `getLiquidityAssetSupplyRate`.
 *
 * Formula: borrowRate * (1 - fee) * borrowWithInterest / supplyWithInterest
 *
 * @param tokenReserve - The on-chain TokenReserve account
 * @returns Supply rate in bps
 */
export function calculateJupLendLiquiditySupplyRate(tokenReserve: JupTokenReserve): bigint {
  const borrowRate = BigInt(tokenReserve.borrowRate);
  const fee = BigInt(tokenReserve.feeOnInterest);

  if (tokenReserve.totalSupplyWithInterest === 0n) {
    return 0n;
  }

  const borrowWithInterestForRate =
    (tokenReserve.totalBorrowWithInterest * tokenReserve.borrowExchangePrice) /
    JUP_EXCHANGE_PRICES_PRECISION;

  const supplyWithInterestForRate =
    (tokenReserve.totalSupplyWithInterest * tokenReserve.supplyExchangePrice) /
    JUP_EXCHANGE_PRICES_PRECISION;

  if (supplyWithInterestForRate === 0n) {
    return 0n;
  }

  return (
    (borrowRate * (10_000n - fee) * borrowWithInterestForRate) /
    (supplyWithInterestForRate * 10_000n)
  );
}

// ============================================================================
// COMBINED SUPPLY RATE (APR)
// ============================================================================

/**
 * Calculate the total supply rate (APR) for a jup-lend market,
 * combining both base liquidity supply rate and rewards rate.
 *
 * Returns a number as a decimal (e.g. 0.05 = 5% APR).
 *
 * @param lendingState - The on-chain Lending account
 * @param tokenReserve - The on-chain TokenReserve account
 * @param rewardsModel - The on-chain LendingRewardsRateModel account (or null if no rewards)
 * @param fTokenTotalSupply - Total supply of the fToken
 * @returns Supply rate as decimal number
 */
export function calculateJupLendSupplyRate(
  lendingState: JupLendingState,
  tokenReserve: JupTokenReserve,
  rewardsModel: JupLendingRewardsRateModel | null,
  fTokenTotalSupply: bigint
): number {
  const supplyRate = calculateJupLendLiquiditySupplyRate(tokenReserve);

  // supplyRate is in bps (e.g. 500 = 5%)
  let totalRateBps = Number(supplyRate);

  if (rewardsModel) {
    const totalAssets = calculateJupLendTotalAssets(lendingState, fTokenTotalSupply);
    const currentTimestamp = BigInt(Math.floor(Date.now() / 1000));
    const { rewardsRate } = calculateJupLendRewardsRate(
      rewardsModel,
      totalAssets,
      currentTimestamp
    );
    // rewardsRate is scaled by 1e4 relative to totalAssets
    totalRateBps += Number(rewardsRate);
  }

  return totalRateBps / 10_000;
}

// ============================================================================
// SUPPLY APY
// ============================================================================

/**
 * Calculate the supply APY for a jup-lend market (base rate only, no rewards).
 *
 * Uses hourly compounding: (1 + apr/HOURS_PER_YEAR)^HOURS_PER_YEAR - 1
 *
 * @param tokenReserve - The on-chain TokenReserve account
 * @returns Supply APY as decimal (e.g. 0.0512 = 5.12% APY)
 */
export function calculateJupLendSupplyAPY(tokenReserve: JupTokenReserve): number {
  const supplyRateBps = calculateJupLendLiquiditySupplyRate(tokenReserve);
  const apr = Number(supplyRateBps) / 1e4;
  return aprToApy(apr);
}

// ============================================================================
// BORROW RATE FROM RATE MODEL (PIECEWISE LINEAR)
// ============================================================================

/**
 * Calculate the borrow rate at a given utilization using the on-chain RateModel.
 *
 * V1 (version=1, single kink):
 *   [0, kink1] → linear rateAtZero → rateAtKink1
 *   [kink1, 10000] → linear rateAtKink1 → rateAtMax
 *
 * V2 (version=2, dual kink):
 *   [0, kink1] → linear rateAtZero → rateAtKink1
 *   [kink1, kink2] → linear rateAtKink1 → rateAtKink2
 *   [kink2, 10000] → linear rateAtKink2 → rateAtMax
 *
 * @param rateModel - The on-chain RateModel account
 * @param utilizationBps - Utilization in bps (0–10000)
 * @returns Borrow rate in bps
 */
export function calculateJupLendBorrowRate(
  rateModel: JupRateModel,
  utilizationBps: number
): number {
  const u = Math.max(0, Math.min(10000, utilizationBps));

  if (rateModel.version === 2) {
    // V2: dual kink
    if (u <= rateModel.kink1Utilization) {
      return linearInterpolate(
        0,
        rateModel.rateAtZero,
        rateModel.kink1Utilization,
        rateModel.rateAtKink1,
        u
      );
    } else if (u <= rateModel.kink2Utilization) {
      return linearInterpolate(
        rateModel.kink1Utilization,
        rateModel.rateAtKink1,
        rateModel.kink2Utilization,
        rateModel.rateAtKink2,
        u
      );
    } else {
      return linearInterpolate(
        rateModel.kink2Utilization,
        rateModel.rateAtKink2,
        10000,
        rateModel.rateAtMax,
        u
      );
    }
  } else {
    // V1: single kink
    if (u <= rateModel.kink1Utilization) {
      return linearInterpolate(
        0,
        rateModel.rateAtZero,
        rateModel.kink1Utilization,
        rateModel.rateAtKink1,
        u
      );
    } else {
      return linearInterpolate(
        rateModel.kink1Utilization,
        rateModel.rateAtKink1,
        10000,
        rateModel.rateAtMax,
        u
      );
    }
  }
}

/**
 * Linear interpolation between two points.
 */
function linearInterpolate(x0: number, y0: number, x1: number, y1: number, x: number): number {
  if (x1 === x0) return y0;
  return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
}

// ============================================================================
// SUPPLY INTEREST RATE CURVE
// ============================================================================

/**
 * Interest rate curve point for visualization (supply only).
 */
export interface JupLendInterestRateCurvePoint {
  utilization: number; // 0-100 percentage
  supplyAPY: number; // percentage
}

/**
 * Generate a supply interest rate curve for a JupLend reserve using the on-chain RateModel.
 *
 * Uses the piecewise linear borrow rate curve from the RateModel account:
 *   borrowAPR(U) = calculateJupLendBorrowRate(rateModel, U * 10000)
 *   supplyAPR(U) = borrowAPR(U) * (1 - feeOnInterest / 1e4) * U
 *   supplyAPY(U) = aprToApy(supplyAPR(U))
 *
 * @param rateModel - The on-chain RateModel account (from liquidity program)
 * @param feeOnInterest - Fee on interest in bps (from TokenReserve.feeOnInterest)
 * @returns 101 curve points (utilization 0–100%)
 */
export function generateJupLendSupplyCurve(
  rateModel: JupRateModel,
  feeOnInterest: number
): JupLendInterestRateCurvePoint[] {
  const feeMultiplier = 1 - feeOnInterest / 1e4;

  return Array.from({ length: 101 }, (_, i) => {
    const utilizationFraction = i / 100; // 0.00 to 1.00
    const utilizationBps = i * 100; // 0 to 10000

    const borrowRateBps = calculateJupLendBorrowRate(rateModel, utilizationBps);
    const borrowRateDecimal = borrowRateBps / 1e4;

    const supplyAPR = borrowRateDecimal * feeMultiplier * utilizationFraction;
    const supplyAPY = aprToApy(supplyAPR);

    return {
      utilization: i, // 0-100
      supplyAPY: supplyAPY * 100, // Convert to percentage
    };
  });
}
