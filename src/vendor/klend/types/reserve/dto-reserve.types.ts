import { BigFractionBytesJSON, LastUpdateJSON } from "../internal";

export interface ReserveJSON {
  /** Version of the reserve */
  version: string;
  /** Last slot when supply and rates updated */
  lastUpdate: LastUpdateJSON;
  /** Lending market address */
  lendingMarket: string;
  farmCollateral: string;
  farmDebt: string;
  /** Reserve liquidity */
  liquidity: ReserveLiquidityJSON;
  reserveLiquidityPadding: Array<string>;
  /** Reserve collateral */
  collateral: ReserveCollateralJSON;
  reserveCollateralPadding: Array<string>;
  /** Reserve configuration values */
  config: ReserveConfigJSON;
  configPadding: Array<string>;
  borrowedAmountOutsideElevationGroup: string;
  /**
   * Amount of token borrowed in lamport of debt asset in the given
   * elevation group when this reserve is part of the collaterals.
   */
  borrowedAmountsAgainstThisReserveInElevationGroups: Array<string>;
  padding: Array<string>;
}

export interface ReserveLiquidityJSON {
  /** Reserve liquidity mint address */
  mintPubkey: string;
  /** Reserve liquidity supply address */
  supplyVault: string;
  /** Reserve liquidity fee collection address */
  feeVault: string;
  /** Reserve liquidity available */
  availableAmount: string;
  /** Reserve liquidity borrowed (scaled fraction) */
  borrowedAmountSf: string;
  /** Reserve liquidity market price in quote currency (scaled fraction) */
  marketPriceSf: string;
  /** Unix timestamp of the market price (from the oracle) */
  marketPriceLastUpdatedTs: string;
  /** Reserve liquidity mint decimals */
  mintDecimals: string;
  /**
   * Timestamp when the last refresh reserve detected that the liquidity amount is above the deposit cap. When this threshold is crossed, then redemptions (auto-deleverage) are enabled.
   * If the threshold is not crossed, then the timestamp is set to 0
   */
  depositLimitCrossedTimestamp: string;
  /**
   * Timestamp when the last refresh reserve detected that the borrowed amount is above the borrow cap. When this threshold is crossed, then redemptions (auto-deleverage) are enabled.
   * If the threshold is not crossed, then the timestamp is set to 0
   */
  borrowLimitCrossedTimestamp: string;
  /** Reserve liquidity cumulative borrow rate (scaled fraction) */
  cumulativeBorrowRateBsf: BigFractionBytesJSON;
  /** Reserve cumulative protocol fees (scaled fraction) */
  accumulatedProtocolFeesSf: string;
  /** Reserve cumulative referrer fees (scaled fraction) */
  accumulatedReferrerFeesSf: string;
  /** Reserve pending referrer fees, to be claimed in refresh_obligation by referrer or protocol (scaled fraction) */
  pendingReferrerFeesSf: string;
  /** Reserve referrer fee absolute rate calculated at each refresh_reserve operation (scaled fraction) */
  absoluteReferralRateSf: string;
  /** Token program of the liquidity mint */
  tokenProgram: string;
  padding2: Array<string>;
  padding3: Array<string>;
}

export interface ReserveCollateralJSON {
  /** Reserve collateral mint address */
  mintPubkey: string;
  /** Reserve collateral mint supply, used for exchange rate */
  mintTotalSupply: string;
  /** Reserve collateral supply address */
  supplyVault: string;
  padding1: Array<string>;
  padding2: Array<string>;
}
export interface ReserveConfigJSON {
  /** Status of the reserve Active/Obsolete/Hidden */
  status: number;
  /** Asset tier -> 0 - regular (collateral & debt), 1 - isolated collateral, 2 - isolated debt */
  assetTier: number;
  /** Flat rate that goes to the host */
  hostFixedInterestRateBps: number;
  /**
   * [DEPRECATED] Space that used to hold 2 fields:
   * - Boost for side (debt or collateral)
   * - Reward points multiplier per obligation type
   * Can be re-used after making sure all underlying production account data is zeroed.
   */
  reserved2: Array<number>;
  /** Cut of the order execution bonus that the protocol receives, as a percentage */
  protocolOrderExecutionFeePct: number;
  /** Protocol take rate is the amount borrowed interest protocol receives, as a percentage */
  protocolTakeRatePct: number;
  /** Cut of the liquidation bonus that the protocol receives, as a percentage */
  protocolLiquidationFeePct: number;
  /**
   * Target ratio of the value of borrows to deposits, as a percentage
   * 0 if use as collateral is disabled
   */
  loanToValuePct: number;
  /** Loan to value ratio at which an obligation can be liquidated, as percentage */
  liquidationThresholdPct: number;
  /** Minimum bonus a liquidator receives when repaying part of an unhealthy obligation, as bps */
  minLiquidationBonusBps: number;
  /** Maximum bonus a liquidator receives when repaying part of an unhealthy obligation, as bps */
  maxLiquidationBonusBps: number;
  /** Bad debt liquidation bonus for an undercollateralized obligation, as bps */
  badDebtLiquidationBonusBps: number;
  /**
   * Time in seconds that must pass before redemptions are enabled after the deposit limit is
   * crossed.
   * Only relevant when `autodeleverage_enabled == 1`, and must not be 0 in such case.
   */
  deleveragingMarginCallPeriodSecs: string;
  /**
   * The rate at which the deleveraging threshold decreases, in bps per day.
   * Only relevant when `autodeleverage_enabled == 1`, and must not be 0 in such case.
   */
  deleveragingThresholdDecreaseBpsPerDay: string;
  /** Program owner fees assessed, separate from gains due to interest accrual */
  fees: ReserveFeesJSON;
  /** Borrow rate curve based on utilization */
  borrowRateCurve: BorrowRateCurveJSON;
  /** Borrow factor in percentage - used for risk adjustment */
  borrowFactorPct: string;
  /** Maximum deposit limit of liquidity in native units, u64::MAX for inf */
  depositLimit: string;
  /** Maximum amount borrowed, u64::MAX for inf, 0 to disable borrows (protected deposits) */
  borrowLimit: string;
  /** Token id from TokenInfos struct */
  tokenInfo: TokenInfoJSON;
  /** Deposit withdrawal caps - deposit & redeem */
  depositWithdrawalCap: WithdrawalCapsJSON;
  /** Debt withdrawal caps - borrow & repay */
  debtWithdrawalCap: WithdrawalCapsJSON;
  elevationGroups: Array<number>;
  disableUsageAsCollOutsideEmode: number;
  /** Utilization (in percentage) above which borrowing is blocked. 0 to disable. */
  utilizationLimitBlockBorrowingAbovePct: number;
  /**
   * Whether this reserve should be subject to auto-deleveraging after deposit or borrow limit is
   * crossed.
   * Besides this flag, the lending market's flag also needs to be enabled (logical `AND`).
   * **NOTE:** the manual "target LTV" deleveraging (enabled by the risk council for individual
   * obligations) is NOT affected by this flag.
   */
  autodeleverageEnabled: number;
  reserved1: Array<number>;
  /**
   * Maximum amount liquidity of this reserve borrowed outside all elevation groups
   * - u64::MAX for inf
   * - 0 to disable borrows outside elevation groups
   */
  borrowLimitOutsideElevationGroup: string;
  /**
   * Defines the maximum amount (in lamports of elevation group debt asset)
   * that can be borrowed when this reserve is used as collateral.
   * - u64::MAX for inf
   * - 0 to disable borrows in this elevation group (expected value for the debt asset)
   */
  borrowLimitAgainstThisCollateralInElevationGroup: Array<string>;
  /**
   * The rate at which the deleveraging-related liquidation bonus increases, in bps per day.
   * Only relevant when `autodeleverage_enabled == 1`, and must not be 0 in such case.
   */
  deleveragingBonusIncreaseBpsPerDay: string;
}

export interface ReserveFeesJSON {
  /**
   * Fee assessed on `BorrowObligationLiquidity`, as scaled fraction (60 bits fractional part)
   * Must be between `0` and `2^60`, such that `2^60 = 1`.  A few examples for
   * clarity:
   * 1% = (1 << 60) / 100 = 11529215046068470
   * 0.01% (1 basis point) = 115292150460685
   * 0.00001% (Aave borrow fee) = 115292150461
   */
  borrowFeeSf: string;
  /**
   * Fee for flash loan, expressed as scaled fraction.
   * 0.3% (Aave flash loan fee) = 0.003 * 2^60 = 3458764513820541
   */
  flashLoanFeeSf: string;
  /** Used for allignment */
  padding: Array<number>;
}

export interface BorrowRateCurveJSON {
  points: Array<CurvePointJSON>;
}

export interface CurvePointJSON {
  utilizationRateBps: number;
  borrowRateBps: number;
}

export interface TokenInfoJSON {
  /** UTF-8 encoded name of the token (null-terminated) */
  name: Array<number>;
  /** Heuristics limits of acceptable price */
  heuristic: PriceHeuristicJSON;
  /** Max divergence between twap and price in bps */
  maxTwapDivergenceBps: string;
  maxAgePriceSeconds: string;
  maxAgeTwapSeconds: string;
  /** Scope price configuration */
  scopeConfiguration: ScopeConfigurationJSON;
  /** Switchboard configuration */
  switchboardConfiguration: SwitchboardConfigurationJSON;
  /** Pyth configuration */
  pythConfiguration: PythConfigurationJSON;
  blockPriceUsage: number;
  reserved: Array<number>;
  padding: Array<string>;
}

export interface PriceHeuristicJSON {
  /** Lower value of acceptable price */
  lower: string;
  /** Upper value of acceptable price */
  upper: string;
  /** Number of decimals of the previously defined values */
  exp: string;
}

export interface ScopeConfigurationJSON {
  /** Pubkey of the scope price feed (disabled if `null` or `default`) */
  priceFeed: string;
  /** This is the scope_id price chain that results in a price for the token */
  priceChain: Array<number>;
  /** This is the scope_id price chain for the twap */
  twapChain: Array<number>;
}

export interface SwitchboardConfigurationJSON {
  /** Pubkey of the base price feed (disabled if `null` or `default`) */
  priceAggregator: string;
  twapAggregator: string;
}

export interface PythConfigurationJSON {
  /** Pubkey of the base price feed (disabled if `null` or `default`) */
  price: string;
}

export interface WithdrawalCapsJSON {
  configCapacity: string;
  currentTotal: string;
  lastIntervalStartTimestamp: string;
  configIntervalLengthSeconds: string;
}
