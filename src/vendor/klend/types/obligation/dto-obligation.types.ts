import { BigFractionBytesJSON, LastUpdateJSON } from "../internal";

export interface ObligationJSON {
  /** Version of the struct */
  tag: string;
  /** Last update to collateral, liquidity, or their market values */
  lastUpdate: LastUpdateJSON;
  /** Lending market address */
  lendingMarket: string;
  /** Owner authority which can borrow liquidity */
  owner: string;
  /** Deposited collateral for the obligation, unique by deposit reserve address */
  deposits: Array<ObligationCollateralJSON>;
  /** Worst LTV for the collaterals backing the loan, represented as a percentage */
  lowestReserveDepositLiquidationLtv: string;
  /** Market value of deposits (scaled fraction) */
  depositedValueSf: string;
  /** Borrowed liquidity for the obligation, unique by borrow reserve address */
  borrows: Array<ObligationLiquidityJSON>;
  /** Risk adjusted market value of borrows/debt (sum of price * borrowed_amount * borrow_factor) (scaled fraction) */
  borrowFactorAdjustedDebtValueSf: string;
  /** Market value of borrows - used for max_liquidatable_borrowed_amount (scaled fraction) */
  borrowedAssetsMarketValueSf: string;
  /** The maximum borrow value at the weighted average loan to value ratio (scaled fraction) */
  allowedBorrowValueSf: string;
  /** The dangerous borrow value at the weighted average liquidation threshold (scaled fraction) */
  unhealthyBorrowValueSf: string;
  /** The asset tier of the deposits */
  depositsAssetTiers: Array<number>;
  /** The asset tier of the borrows */
  borrowsAssetTiers: Array<number>;
  /** The elevation group id the obligation opted into. */
  elevationGroup: number;
  /** The number of obsolete reserves the obligation has a deposit in */
  numOfObsoleteDepositReserves: number;
  /** Marked = 1 if borrows array is not empty, 0 = borrows empty */
  hasDebt: number;
  /** Wallet address of the referrer */
  referrer: string;
  /** Marked = 1 if borrowing disabled, 0 = borrowing enabled */
  borrowingDisabled: number;
  /**
   * A target LTV set by the risk council when marking this obligation for deleveraging.
   * Only effective when `deleveraging_margin_call_started_slot != 0`.
   */
  autodeleverageTargetLtvPct: number;
  /** The lowest max LTV found amongst the collateral deposits */
  lowestReserveDepositMaxLtvPct: number;
  /** The number of obsolete reserves the obligation has a borrow in */
  numOfObsoleteBorrowReserves: number;
  reserved: Array<number>;
  highestBorrowFactorPct: string;
  /**
   * A timestamp at which the risk council most-recently marked this obligation for deleveraging.
   * Zero if not currently subject to deleveraging.
   */
  autodeleverageMarginCallStartedTimestamp: string;
  /**
   * Owner-defined, liquidator-executed orders applicable to this obligation.
   * Typical use-cases would be a stop-loss and a take-profit (possibly co-existing).
   */
  orders: Array<ObligationOrderJSON>;
  padding3: Array<string>;
}

export interface ObligationLiquidityJSON {
  /** Reserve liquidity is borrowed from */
  borrowReserve: string;
  /** Borrow rate used for calculating interest (big scaled fraction) */
  cumulativeBorrowRateBsf: BigFractionBytesJSON;
  padding: string;
  /** Amount of liquidity borrowed plus interest (scaled fraction) */
  borrowedAmountSf: string;
  /** Liquidity market value in quote currency (scaled fraction) */
  marketValueSf: string;
  /** Risk adjusted liquidity market value in quote currency - DEBUG ONLY - use market_value instead */
  borrowFactorAdjustedMarketValueSf: string;
  /** Amount of liquidity borrowed outside of an elevation group */
  borrowedAmountOutsideElevationGroups: string;
  padding2: Array<string>;
}

export interface ObligationCollateralJSON {
  /** Reserve collateral is deposited to */
  depositReserve: string;
  /** Amount of collateral deposited */
  depositedAmount: string;
  /** Collateral market value in quote currency (scaled fraction) */
  marketValueSf: string;
  /**
   * Debt amount (lamport) taken against this collateral.
   * (only meaningful if this obligation is part of an elevation group, otherwise 0)
   * This is only indicative of the debt computed on the last refresh obligation.
   * If the obligation have multiple collateral this value is the same for all of them.
   */
  borrowedAmountAgainstThisCollateralInElevationGroup: string;
  padding: Array<string>;
}

export interface ObligationOrderJSON {
  /**
   * A threshold value used by the condition (scaled [Fraction]).
   * The exact meaning depends on the specific [Self::condition_type].
   *
   * Examples:
   * - when `condition_type == 2 (UserLtvBelow)`:
   * then a value of `0.455` here means that the order is active only when the obligation's
   * user LTV is less than `0.455` (i.e. < 45.5%).
   * - when `condition_type == 3 (DebtCollPriceRatioAbove)`:
   * assuming the obligation uses BTC collateral for SOL debt, then a value of `491.3` here
   * means that the order is active only when the BTC-SOL price is greater than `491.3` (i.e.
   * > 491.3 SOL per BTC).
   */
  conditionThresholdSf: string;
  /**
   * A configuration parameter used by the opportunity (scaled [Fraction]).
   * The exact meaning depends on the specific [Self::opportunity_type].
   *
   * Examples:
   * - when `opportunity_type == 0 (DeleverageSingleDebtAmount)`:
   * Assuming the obligation uses BTC collateral for SOL debt, then a value of `1_234_000_000`
   * here means that a liquidator may repay up to 1234000000 lamports (i.e. 1.234 SOL) on this
   * obligation.
   * Note: the special value of [Fraction::MAX] is *not* allowed in this case.
   * - when `opportunity_type == 1 (DeleverageAllDebtAmount)`:
   * The only allowed value in this case is [Fraction::MAX] (to emphasize that *all* debt
   * should be repaid).
   */
  opportunityParameterSf: string;
  /**
   * A *minimum* additional fraction of collateral transferred to the liquidator, in bps.
   *
   * The minimum bonus is applied exactly when the [Self::condition_threshold_sf] is met, and
   * grows linearly towards the [Self::max_execution_bonus_bps].
   *
   * Example: a value of `50` here means 50bps == 0.5% bonus for an "LTV > 65%" order, when
   * executed precisely at the moment LTV exceeds 65%.
   */
  minExecutionBonusBps: number;
  /**
   * A *maximum* additional fraction of collateral transferred to the liquidator, in bps.
   *
   * The maximum bonus is applied at the relevant "extreme" state of the obligation, i.e.:
   * - for a stop-loss condition, it is a point at which the obligation becomes liquidatable;
   * - for a take-profit condition, it is a point at which obligation has 0% LTV.
   *
   * In non-extreme states, the actual bonus value is interpolated linearly, starting from
   * [Self::min_execution_bonus_bps] (at the point specified by the order's condition).
   *
   * Example: a value of `300` here means 300bps == 3.0% bonus for a "debt/coll price > 140"
   * order, when executed at a higher price = 200, at which the obligation's LTV happens to
   * be equal to its liquidation LTV.
   */
  maxExecutionBonusBps: number;
  /**
   * Serialized [ConditionType].
   * The entire order is void when this is zeroed (i.e. representing [ConditionType::Never]).
   *
   * Example: a value of `2` here denotes `UserLtvBelow` condition type. Of course, to
   * interpret this condition, we also need to take the [Self::condition_threshold_sf] into
   * account.
   */
  conditionType: number;
  /**
   * Serialized [OpportunityType].
   *
   * Example: a value of `0` here denotes `DeleverageSingleDebtAmount` opportunity. Of course, to
   * interpret this opportunity, we also need to take the [Self::opportunity_parameter_sf] into
   * account.
   */
  opportunityType: number;
  /**
   * Internal padding.
   * The fields above take up 2+2+1+1 bytes = 48 bits, which means we need 80 bits = 10 bytes to
   * align with `u128`s.
   */
  padding1: Array<number>;
  /**
   * End padding.
   * The total size of a single instance is 8*u128 = 128 bytes.
   */
  padding2: Array<string>;
}
