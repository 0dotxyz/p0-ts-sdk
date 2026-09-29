import { BigNumber } from "bignumber.js";

import { AssetTag, BankType, OperationalState } from "../types";

import { computeInterestRates } from "./interest-rate.utils";
import { getTotalAssetQuantity, getTotalLiabilityQuantity } from "./shares.utils";

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

/**
 * Whether a bank can be borrowed with the standard `lending_account_borrow` instruction.
 *
 * Only `DEFAULT`/`SOL` asset-tag banks are borrowable on-chain; the integration wrappers
 * (KAMINO/DRIFT/SOLEND/JUPLEND) reuse the same mint with `borrowLimit=0` and reject a standard
 * borrow with `6200 WrongAssetTagForStandardInstructions`. Use this when picking a bank to *borrow*
 * (e.g. the bridge bank for a debt-swap or loop double-hop).
 */
export function isStandardBorrowable(bank: BankType): boolean {
  const { assetTag, operationalState, borrowLimit } = bank.config;
  return (
    (assetTag === AssetTag.DEFAULT || assetTag === AssetTag.SOL) &&
    operationalState === OperationalState.Operational &&
    borrowLimit.gt(0)
  );
}

/**
 * Whether a bank accepts standard deposits. `ReduceOnly`/`Paused` banks reject new deposits with
 * `6017 BankReduceOnly`; integration wrappers aren't standard-depositable either. Use this when
 * picking a bank to *deposit* into (e.g. the bridge bank for a collateral-swap double-hop).
 */
export function isStandardDepositable(bank: BankType): boolean {
  const { assetTag, operationalState } = bank.config;
  return (
    (assetTag === AssetTag.DEFAULT || assetTag === AssetTag.SOL) &&
    operationalState === OperationalState.Operational
  );
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
