import BN from "bn.js";
import { JupLendingStateRaw, JupLendingRewardsRateModelRaw, JupTokenReserveRaw } from "../types";

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
  lendingState: JupLendingStateRaw,
  fTokenTotalSupply: BN
): BN {
  return lendingState.tokenExchangePrice
    .mul(fTokenTotalSupply)
    .div(JUP_EXCHANGE_PRICES_PRECISION);
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
  rewardsModel: JupLendingRewardsRateModelRaw,
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

  let rewardsRate = rewardsModel.yearlyReward
    .mul(new BN(1e4))
    .div(totalAssets);

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
// EXCHANGE PRICE PROJECTION
// ============================================================================

/**
 * Project the new token exchange price offline (no RPC calls).
 * Extracted from compiled SDK's `getNewExchangePrice`.
 *
 * This combines:
 * 1. Rewards rate contribution (time-weighted)
 * 2. Liquidity exchange price delta
 *
 * @param lendingState - The on-chain Lending account
 * @param currentLiquidityExchangePrice - Current supply exchange price from TokenReserve
 * @param rewardsRate - From calculateJupLendRewardsRate
 * @param rewardsStartTime - From calculateJupLendRewardsRate
 * @param currentTimestamp - Current unix timestamp (seconds)
 * @returns Projected token exchange price as BN
 */
export function calculateJupLendNewExchangePrice(
  lendingState: JupLendingStateRaw,
  currentLiquidityExchangePrice: BN,
  rewardsRate: BN,
  rewardsStartTime: BN,
  currentTimestamp: BN
): BN {
  const oldTokenExchangePrice = lendingState.tokenExchangePrice;
  const oldLiquidityExchangePrice = lendingState.liquidityExchangePrice;

  let lastUpdateTime = lendingState.lastUpdateTimestamp;
  if (lastUpdateTime.lt(rewardsStartTime)) {
    lastUpdateTime = rewardsStartTime;
  }

  // Rewards contribution: rate * timeDelta / SECONDS_PER_YEAR
  let totalReturnPercent = rewardsRate
    .mul(currentTimestamp.sub(lastUpdateTime))
    .div(JUP_SECONDS_PER_YEAR);

  // Liquidity exchange price delta contribution
  const delta = currentLiquidityExchangePrice.sub(oldLiquidityExchangePrice);
  totalReturnPercent = totalReturnPercent.add(
    delta.mul(new BN(1e14)).div(oldLiquidityExchangePrice)
  );

  return oldTokenExchangePrice.add(
    oldTokenExchangePrice.mul(totalReturnPercent).div(new BN(1e14))
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
 * @returns Supply rate as BN (in bps-like precision from the liquidity layer)
 */
export function calculateJupLendLiquiditySupplyRate(
  tokenReserve: JupTokenReserveRaw
): BN {
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
  lendingState: JupLendingStateRaw,
  tokenReserve: JupTokenReserveRaw,
  rewardsModel: JupLendingRewardsRateModelRaw | null,
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
