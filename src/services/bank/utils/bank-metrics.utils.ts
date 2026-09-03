import BigNumber from "bignumber.js";

import { aprToApy } from "../../../utils/accounting.utils";
import { nativeToUi } from "../../../utils/conversion.utils";
import { OraclePrice, PriceBias } from "../../price/types/price.types";
import { AssetTag, BankType, OperationalState } from "../types";

import { computeUsdValue, getTotalAssetQuantity, getTotalLiabilityQuantity } from "./compute";
import {
  computeAccrualProjectionSeconds,
  computeInterestRates,
  computeRemainingCapacity,
  computeUtilizationRate,
  isBorrowLimitActive,
  isDepositLimitActive,
  SECONDS_PER_YEAR,
} from "./interest-rate.utils";

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

/**
 * Computed metrics describing a bank's state at a given moment.
 *
 * All amounts are UI-scaled (decimals applied). USD values use the bank's
 * realtime oracle price without any margin weight applied.
 */
export interface BankMetrics {
  /** Token symbol hint supplied by the caller (e.g. from bank metadata). Empty string if unknown. */
  symbol: string;
  /** Total deposits in UI units (asset share value multiplier applied). */
  totalDeposits: number;
  /** Total borrows in UI units. */
  totalBorrows: number;
  /** USD value of total deposits (realtime oracle price). */
  totalDepositsUsd: number;
  /** USD value of total borrows (realtime oracle price). */
  totalBorrowsUsd: number;
  /** Utilization rate in [0,1]. */
  utilizationRate: number;
  /** Available liquidity in UI units. */
  poolSize: number;
  /** Deposit cap in UI units. */
  depositCap: number;
  /** Borrow cap in UI units. */
  borrowCap: number;
  /** Remaining deposit capacity. */
  depositCapRemaining: number;
  /** Remaining borrow capacity. */
  borrowCapRemaining: number;
  /** Supply APY (compounded annually from the base lending rate). */
  supplyApy: number;
  /** Borrow APY (compounded annually from the borrowing rate). */
  borrowApy: number;
}

export interface ComputeBankMetricsParams {
  bank: BankType;
  oraclePrice: OraclePrice;
  /** Asset share value multiplier (e.g. Kamino). Defaults to 1. */
  assetShareValueMultiplier?: BigNumber;
  /** Symbol hint surfaced on the returned metrics. */
  symbol?: string;
}

/**
 * Total deposits in UI units, with the asset-share-value multiplier applied (defaults to 1).
 */
export function computeBankTotalDeposits(
  bank: BankType,
  assetShareValueMultiplier?: BigNumber
): number {
  const totalAssets = getTotalAssetQuantity(bank).times(assetShareValueMultiplier ?? 1);
  return nativeToUi(totalAssets, bank.mintDecimals);
}

/**
 * Total borrows in UI units. Borrows aren't share-multiplied.
 */
export function computeBankTotalBorrows(bank: BankType): number {
  return nativeToUi(getTotalLiabilityQuantity(bank), bank.mintDecimals);
}

/**
 * USD value of total deposits, computed from the realtime oracle price
 * (no margin weight, no price bias).
 */
export function computeBankTotalDepositsUsd(
  bank: BankType,
  oraclePrice: OraclePrice,
  assetShareValueMultiplier?: BigNumber
): number {
  return computeUsdValue({
    bank,
    oraclePrice,
    quantity: getTotalAssetQuantity(bank),
    priceBias: PriceBias.None,
    isWeightedPrice: false,
    assetShareValueMultiplier,
  }).toNumber();
}

/**
 * USD value of total borrows, computed from the realtime oracle price
 * (no margin weight, no price bias).
 */
export function computeBankTotalBorrowsUsd(bank: BankType, oraclePrice: OraclePrice): number {
  return computeUsdValue({
    bank,
    oraclePrice,
    quantity: getTotalLiabilityQuantity(bank),
    priceBias: PriceBias.None,
    isWeightedPrice: false,
  }).toNumber();
}

/**
 * Available liquidity (UI units) = min(totalDeposits, borrowCap) - totalBorrows, clamped to 0.
 * Matches the existing UI calculation used to gate borrow-side displays.
 */
export function computeBankPoolSize(bank: BankType, assetShareValueMultiplier?: BigNumber): number {
  const totalDeposits = computeBankTotalDeposits(bank, assetShareValueMultiplier);
  const totalBorrows = computeBankTotalBorrows(bank);
  const borrowCap = nativeToUi(bank.config.borrowLimit, bank.mintDecimals);
  return Math.max(0, Math.min(totalDeposits, borrowCap) - totalBorrows);
}

/**
 * Available bank liquidity in UI units = max(0, totalDeposits - totalBorrows).
 *
 * This is the amount the bank's liquidity vault can actually pay out for a withdraw or borrow,
 * independent of any account-level health constraints.
 */
export function computeBankAvailableLiquidity(
  bank: BankType,
  assetShareValueMultiplier?: BigNumber
): BigNumber {
  const totalDeposits = computeBankTotalDeposits(bank, assetShareValueMultiplier);
  const totalBorrows = computeBankTotalBorrows(bank);
  return BigNumber.max(0, new BigNumber(totalDeposits).minus(totalBorrows));
}

/**
 * Remaining deposit capacity in UI units (cap minus deposits, accounting for accrued interest),
 * clamped at 0. `Infinity` when the bank's deposit limit is inactive (`u64::MAX`).
 *
 * For integrated banks this is in the bank's share units (cToken / Drift scaled balance);
 * multiply by the bank's `assetShareValueMultiplier` to convert to underlying tokens.
 */
export function computeBankDepositCapRemaining(bank: BankType): number {
  if (!isDepositLimitActive(bank)) return Infinity;
  const { depositCapacity } = computeRemainingCapacity(bank);
  return Math.max(0, nativeToUi(depositCapacity, bank.mintDecimals));
}

/**
 * Remaining borrow capacity in UI units (cap minus borrows, accounting for accrued interest),
 * clamped at 0. `Infinity` when the bank's borrow limit is inactive (`u64::MAX`).
 */
export function computeBankBorrowCapRemaining(bank: BankType): number {
  if (!isBorrowLimitActive(bank)) return Infinity;
  const { borrowCapacity } = computeRemainingCapacity(bank);
  return Math.max(0, nativeToUi(borrowCapacity, bank.mintDecimals));
}

/**
 * Available liquidity (UI units) projected through interest accrual: `computeBankAvailableLiquidity`
 * minus the net liquidity drain of accrual (`liabilities * borrowRate - assets * lendingRate`,
 * annualized) over {@link computeAccrualProjectionSeconds}. The program runs `accrue_interest`
 * before its `check_utilization_ratio` (assets >= liabilities) check on withdraws and borrows,
 * so this is the amount that can actually leave the bank when the tx lands.
 */
export function computeBankProjectedAvailableLiquidity(
  bank: BankType,
  assetShareValueMultiplier?: BigNumber
): BigNumber {
  const liquidity = computeBankAvailableLiquidity(bank, assetShareValueMultiplier);
  const totalDeposits = computeBankTotalDeposits(bank, assetShareValueMultiplier);
  const totalBorrows = computeBankTotalBorrows(bank);
  const projectionYears = computeAccrualProjectionSeconds(bank) / SECONDS_PER_YEAR;
  const { lendingRate, borrowingRate } = computeInterestRates(bank);

  // When interest is accrued, total liabilities grow by the borrow interest and total assets grow
  // by the lending interest. The difference (the protocol/insurance fee share) is liquidity that
  // will no longer be available once the instruction runs `accrue_interest`.
  const projectedBorrowInterest = borrowingRate.times(totalBorrows).times(projectionYears);
  const projectedLendingInterest = lendingRate.times(totalDeposits).times(projectionYears);
  const liquidityLostToAccrual = BigNumber.max(
    0,
    projectedBorrowInterest.minus(projectedLendingInterest)
  );

  return BigNumber.max(0, liquidity.minus(liquidityLostToAccrual));
}

/**
 * Supply APY, compounded from the base lending rate via the shared `aprToApy` helper.
 */
export function computeBankSupplyApy(bank: BankType): number {
  return aprToApy(computeInterestRates(bank).lendingRate.toNumber());
}

/**
 * Borrow APY, compounded from the borrowing rate via the shared `aprToApy` helper.
 */
export function computeBankBorrowApy(bank: BankType): number {
  return aprToApy(computeInterestRates(bank).borrowingRate.toNumber());
}

/**
 * Aggregator over all per-metric subfunctions. Use this when you want every UI field
 * for a bank in one call; use the per-metric helpers when you only need one or two
 * (no need to compute oracle math just to read utilization, etc.).
 *
 * Pure: pass whatever `(bank, oraclePrice)` snapshot you want reflected (live,
 * post-simulation, or synthetically mutated).
 */
export function computeBankMetrics(params: ComputeBankMetricsParams): BankMetrics {
  const { bank, oraclePrice, assetShareValueMultiplier, symbol = "" } = params;

  return {
    symbol,
    totalDeposits: computeBankTotalDeposits(bank, assetShareValueMultiplier),
    totalBorrows: computeBankTotalBorrows(bank),
    totalDepositsUsd: computeBankTotalDepositsUsd(bank, oraclePrice, assetShareValueMultiplier),
    totalBorrowsUsd: computeBankTotalBorrowsUsd(bank, oraclePrice),
    utilizationRate: computeUtilizationRate(bank).toNumber(),
    poolSize: computeBankPoolSize(bank, assetShareValueMultiplier),
    depositCap: nativeToUi(bank.config.depositLimit, bank.mintDecimals),
    borrowCap: nativeToUi(bank.config.borrowLimit, bank.mintDecimals),
    depositCapRemaining: computeBankDepositCapRemaining(bank),
    borrowCapRemaining: computeBankBorrowCapRemaining(bank),
    supplyApy: computeBankSupplyApy(bank),
    borrowApy: computeBankBorrowApy(bank),
  };
}
