import BN from "bn.js";
import { aprToApy } from "~/utils";
import {
  JupLendingState,
  JupLendingRewardsRateModel,
  JupTokenReserve,
  JupRateModel,
} from "../types";

/**
 * Jup-Lend Interest Rate & Exchange Price Utilities
 *
 * Extracted from the compiled @jup-ag/lend SDK (earn/index.mjs).
 * All functions work on pre-fetched state — no RPC calls.
 */

// ============================================================================
// CONSTANTS
// ============================================================================

export const JUP_EXCHANGE_PRICES_PRECISION = new BN("1000000000000"); // 1e12
export const JUP_SECONDS_PER_YEAR = new BN(31_536_000);
export const JUP_MAX_REWARDS_RATE = new BN("50000000000000"); // 50 * 1e12 = 50%

// ============================================================================
// TOTAL ASSETS
// ============================================================================

/**
 * Calculate total assets for a jup-lend market.
 * Formula: tokenExchangePrice * fTokenTotalSupply / EXCHANGE_PRICES_PRECISION
 *
 * @param lendingState - The on-chain Lending account
 * @param fTokenTotalSupply - Total supply of the fToken (from getTokenSupply)
 * @returns Total assets as BN in underlying token lamports
 */
export function calculateJupLendTotalAssets(
  lendingState: JupLendingState,
  fTokenTotalSupply: BN
): BN {
  return lendingState.tokenExchangePrice.mul(fTokenTotalSupply).div(JUP_EXCHANGE_PRICES_PRECISION);
}

// ============================================================================
// REWARDS RATE
// ============================================================================

export interface JupLendRewardsResult {
  rewardsRate: BN;
  rewardsEnded: boolean;
  rewardsStartTime: BN;
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
  totalAssets: BN,
  currentTimestamp: BN
): JupLendRewardsResult {
  const defaultResult: JupLendRewardsResult = {
    rewardsRate: new BN(0),
    rewardsEnded: false,
    rewardsStartTime: rewardsModel.startTime,
  };

  if (rewardsModel.startTime.isZero() || rewardsModel.duration.isZero()) {
    return defaultResult;
  }

  if (currentTimestamp.gt(rewardsModel.startTime.add(rewardsModel.duration))) {
    return { ...defaultResult, rewardsEnded: true };
  }

  if (totalAssets.lt(rewardsModel.startTvl)) {
    return defaultResult;
  }

  let rewardsRate = rewardsModel.yearlyReward.mul(new BN(1e4)).div(totalAssets);

  if (rewardsRate.gt(JUP_MAX_REWARDS_RATE)) {
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
  totalAssets: BN,
  currentTimestamp: BN
): { rate: BN; rewardsStartTime: BN } {
  const defaultResult = { rate: new BN(0), rewardsStartTime: rewardsModel.startTime };

  if (rewardsModel.startTime.isZero() || rewardsModel.duration.isZero()) {
    return defaultResult;
  }

  if (currentTimestamp.gt(rewardsModel.startTime.add(rewardsModel.duration))) {
    return defaultResult;
  }

  if (totalAssets.lt(rewardsModel.startTvl)) {
    return defaultResult;
  }

  let rate = rewardsModel.yearlyReward.mul(JUP_EXCHANGE_PRICES_PRECISION).div(totalAssets);

  if (rate.gt(JUP_MAX_REWARDS_RATE)) {
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
 * @returns Projected token exchange price as BN (1e12 precision)
 */
export function calculateJupLendNewExchangePrice(
  lendingState: JupLendingState,
  tokenReserve: JupTokenReserve,
  rewardsModel: JupLendingRewardsRateModel | null,
  fTokenTotalSupply: BN,
  currentTimestamp: BN
): BN {
  const oldTokenExchangePrice = lendingState.tokenExchangePrice;
  const oldLiquidityExchangePrice = lendingState.liquidityExchangePrice;
  const currentLiquidityExchangePrice = tokenReserve.supplyExchangePrice;

  // Rewards component — must use 1e12-precision rate (mirrors SDK getRewardsRate, not calculateRewardsRate)
  let rewardsRate = new BN(0);
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
  if (lastUpdateTime.lt(rewardsStartTime)) {
    lastUpdateTime = rewardsStartTime;
  }

  const secondsElapsed = currentTimestamp.sub(lastUpdateTime);

  // Rewards contribution: rate (1e12) * secondsElapsed / SECONDS_PER_YEAR → ~1e12 scale
  // Scaled up to 1e14 to match the liquidity delta component
  let totalReturnPercent = rewardsRate
    .mul(secondsElapsed)
    .div(JUP_SECONDS_PER_YEAR)
    .mul(new BN(100)); // 1e12 → 1e14

  // Liquidity exchange price delta contribution (1e14 precision)
  const delta = currentLiquidityExchangePrice.sub(oldLiquidityExchangePrice);
  totalReturnPercent = totalReturnPercent.add(
    delta.mul(new BN(1e14)).div(oldLiquidityExchangePrice)
  );

  return oldTokenExchangePrice.add(oldTokenExchangePrice.mul(totalReturnPercent).div(new BN(1e14)));
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
 * @returns Supply rate as BN (in bps-like precision from the liquidity layer)
 */
export function calculateJupLendLiquiditySupplyRate(tokenReserve: JupTokenReserve): BN {
  const borrowRate = new BN(tokenReserve.borrowRate);
  const fee = new BN(tokenReserve.feeOnInterest);

  if (tokenReserve.totalSupplyWithInterest.isZero()) {
    return new BN(0);
  }

  const borrowWithInterestForRate = tokenReserve.totalBorrowWithInterest
    .mul(tokenReserve.borrowExchangePrice)
    .div(JUP_EXCHANGE_PRICES_PRECISION);

  const supplyWithInterestForRate = tokenReserve.totalSupplyWithInterest
    .mul(tokenReserve.supplyExchangePrice)
    .div(JUP_EXCHANGE_PRICES_PRECISION);

  if (supplyWithInterestForRate.isZero()) {
    return new BN(0);
  }

  return borrowRate
    .mul(new BN(1e4).sub(fee))
    .mul(borrowWithInterestForRate)
    .div(supplyWithInterestForRate.mul(new BN(1e4)));
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
  fTokenTotalSupply: BN
): number {
  const supplyRate = calculateJupLendLiquiditySupplyRate(tokenReserve);

  // supplyRate is in bps (e.g. 500 = 5%)
  let totalRateBps = supplyRate.toNumber();

  if (rewardsModel) {
    const totalAssets = calculateJupLendTotalAssets(lendingState, fTokenTotalSupply);
    const currentTimestamp = new BN(Math.floor(Date.now() / 1000));
    const { rewardsRate } = calculateJupLendRewardsRate(
      rewardsModel,
      totalAssets,
      currentTimestamp
    );
    // rewardsRate is scaled by 1e4 relative to totalAssets
    totalRateBps += rewardsRate.toNumber();
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
  const apr = supplyRateBps.toNumber() / 1e4;
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
