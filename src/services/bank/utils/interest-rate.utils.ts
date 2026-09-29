import { BigNumber } from "bignumber.js";

import { AssetTag, BankType } from "../types";

import { getTotalAssetQuantity, getTotalLiabilityQuantity } from "./compute";

/** On-chain sentinel: a deposit/borrow limit equal to `u64::MAX` means "no limit". */
export const U64_MAX = new BigNumber("18446744073709551615");

/** Drift balances are tracked in 9-decimal "scaled balance" units on-chain. */
const DRIFT_SCALED_BALANCE_DECIMALS = 9;

/** Mirrors `BankConfig::is_deposit_limit_active` (limit != u64::MAX). */
export function isDepositLimitActive(bank: BankType): boolean {
  return !bank.config.depositLimit.eq(U64_MAX);
}

/** Mirrors `BankConfig::is_borrow_limit_active` (limit != u64::MAX). */
export function isBorrowLimitActive(bank: BankType): boolean {
  return !bank.config.borrowLimit.eq(U64_MAX);
}

/**
 * The deposit limit in the same units as `totalAssetShares * assetShareValue`.
 *
 * For Drift banks the program compares the limit against the 9-decimal scaled balance, so it
 * scales `deposit_limit` (mint decimals) by `10^(9 - mint_decimals)` first
 * (`scale_drift_deposit_limit`). All other banks compare the raw limit.
 */
export function getEffectiveDepositLimit(bank: BankType): BigNumber {
  const limit = bank.config.depositLimit;
  if (bank.config.assetTag !== AssetTag.DRIFT) return limit;
  const diff = DRIFT_SCALED_BALANCE_DECIMALS - bank.mintDecimals;
  if (diff === 0) return limit;
  return diff > 0 ? limit.times(10 ** diff) : limit.div(10 ** -diff);
}

export function computeInterestRates(bank: BankType): {
  lendingRate: BigNumber;
  borrowingRate: BigNumber;
} {
  const { insuranceFeeFixedApr, insuranceIrFee, protocolFixedFeeApr, protocolIrFee } =
    bank.config.interestRateConfig;

  const fixedFee = insuranceFeeFixedApr.plus(protocolFixedFeeApr);
  const rateFee = insuranceIrFee.plus(protocolIrFee);

  const baseInterestRate = computeBaseInterestRate(bank);
  const utilizationRate = computeUtilizationRate(bank);

  const lendingRate = baseInterestRate.times(utilizationRate);
  const borrowingRate = baseInterestRate.times(new BigNumber(1).plus(rateFee)).plus(fixedFee);

  return { lendingRate, borrowingRate };
}

const U32_MAX = 0xffffffff;

// Rates are encoded out of 1000%, so u32::MAX is an APR of 10.
function rateFromU32(rate: number): BigNumber {
  const ratio = new BigNumber(rate).div(U32_MAX);
  return ratio.times(10);
}

function calculateRateBetweenPoints(
  startX: BigNumber,
  startY: BigNumber,
  endX: BigNumber,
  endY: BigNumber,
  targetX: BigNumber
): BigNumber {
  if (endX.lte(startX)) return startY;
  if (targetX.lt(startX)) return startY;
  if (targetX.gt(endX)) return endY;
  if (endY.lt(startY)) return startY;

  const deltaX = endX.minus(startX);
  if (deltaX.isZero()) return startY;

  const offset = targetX.minus(startX);
  const proportion = offset.div(deltaX);
  const deltaY = endY.minus(startY);
  const scaledDelta = deltaY.times(proportion);

  return startY.plus(scaledDelta);
}

function computeLegacyCurve(
  utilizationRate: BigNumber,
  optimalUtilizationRate: BigNumber,
  plateauInterestRate: BigNumber,
  maxInterestRate: BigNumber
): BigNumber {
  if (utilizationRate.lte(optimalUtilizationRate)) {
    return utilizationRate.times(plateauInterestRate).div(optimalUtilizationRate);
  } else {
    return utilizationRate
      .minus(optimalUtilizationRate)
      .div(new BigNumber(1).minus(optimalUtilizationRate))
      .times(maxInterestRate.minus(plateauInterestRate))
      .plus(plateauInterestRate);
  }
}

function computeMultipointCurve(
  utilizationRate: BigNumber,
  zeroUtilRate: number,
  hundredUtilRate: number,
  points: Array<{ util: number; rate: number }>
): BigNumber {
  const zeroRate = rateFromU32(zeroUtilRate);
  const hundredRate = rateFromU32(hundredUtilRate);

  const clampedUtilizationRate = BigNumber.max(0, BigNumber.min(1, utilizationRate));

  // Points with util = 0 are unused padding on-chain.
  const nonPaddingPoints = points.filter((point) => point.util !== 0);

  let prevUtil = new BigNumber(0);
  let prevRate = zeroRate;

  for (const point of nonPaddingPoints) {
    const pointUtil = new BigNumber(point.util).div(U32_MAX);
    const pointRate = rateFromU32(point.rate);

    if (clampedUtilizationRate.lte(pointUtil)) {
      return calculateRateBetweenPoints(
        prevUtil,
        prevRate,
        pointUtil,
        pointRate,
        clampedUtilizationRate
      );
    }

    prevUtil = pointUtil;
    prevRate = pointRate;
  }

  return calculateRateBetweenPoints(
    prevUtil,
    prevRate,
    new BigNumber(1),
    hundredRate,
    clampedUtilizationRate
  );
}

export function computeBaseInterestRate(bank: BankType): BigNumber {
  const interestRateConfig = bank.config.interestRateConfig;
  const utilizationRate = computeUtilizationRate(bank);
  const curveType = interestRateConfig.curveType;

  // curveType 0 banks never migrated to the 7-point curve; their legacy params still sit in the
  // deprecated placeholder slots, which other curve types may reuse.
  if (curveType === 0) {
    return computeLegacyCurve(
      utilizationRate,
      interestRateConfig.placeholder0,
      interestRateConfig.placeholder1,
      interestRateConfig.placeholder2
    );
  }

  return computeMultipointCurve(
    utilizationRate,
    interestRateConfig.zeroUtilRate,
    interestRateConfig.hundredUtilRate,
    interestRateConfig.points
  );
}

export function computeUtilizationRate(bank: BankType): BigNumber {
  const assets = getTotalAssetQuantity(bank);
  const liabilities = getTotalLiabilityQuantity(bank);
  if (assets.isZero()) return new BigNumber(0);
  return liabilities.div(assets);
}

const SECONDS_PER_DAY = 24 * 60 * 60;
/** Mirrors the program's `SECONDS_PER_YEAR` (365 days, no leap adjustment). */
export const SECONDS_PER_YEAR = SECONDS_PER_DAY * 365;

/**
 * Minimum execution headroom (seconds) assumed between computing a bank-bounded amount and the
 * transaction landing on-chain. Interest keeps accruing in that window, so bounds that depend on
 * accrued interest are projected at least this far ahead.
 */
export const EXECUTION_HEADROOM_SECONDS = 120;

/**
 * Seconds of interest accrual to project for a bank-bounded amount: the program accrues
 * `now - lastUpdate` before applying its checks, and the tx lands some time after `now`.
 * Returns `max(2 * age, age + EXECUTION_HEADROOM_SECONDS)`.
 */
export function computeAccrualProjectionSeconds(
  bank: BankType,
  nowSeconds = Date.now() / 1000
): number {
  const age = Math.max(0, nowSeconds - bank.lastUpdate);
  return Math.max(2 * age, age + EXECUTION_HEADROOM_SECONDS);
}

export function computeRemainingCapacity(bank: BankType): {
  depositCapacity: BigNumber;
  borrowCapacity: BigNumber;
} {
  const totalDeposits = getTotalAssetQuantity(bank);
  const remainingCapacity = isDepositLimitActive(bank)
    ? BigNumber.max(
        0,
        getEffectiveDepositLimit(bank)
          .minus(totalDeposits)
          .minus(1)
          .integerValue(BigNumber.ROUND_FLOOR)
      )
    : U64_MAX;

  const totalBorrows = getTotalLiabilityQuantity(bank);
  const remainingBorrowCapacity = isBorrowLimitActive(bank)
    ? BigNumber.max(
        0,
        bank.config.borrowLimit.minus(totalBorrows).minus(1).integerValue(BigNumber.ROUND_FLOOR)
      )
    : U64_MAX;

  const projectionSeconds = computeAccrualProjectionSeconds(bank);

  const { lendingRate, borrowingRate } = computeInterestRates(bank);

  const projectedLendingInterest = lendingRate
    .times(projectionSeconds)
    .dividedBy(SECONDS_PER_YEAR)
    .times(totalDeposits);
  const projectedBorrowInterest = borrowingRate
    .times(projectionSeconds)
    .dividedBy(SECONDS_PER_YEAR)
    .times(totalBorrows);

  const depositCapacity = remainingCapacity.minus(projectedLendingInterest);
  const borrowCapacity = remainingBorrowCapacity.minus(projectedBorrowInterest);

  return {
    depositCapacity,
    borrowCapacity,
  };
}
