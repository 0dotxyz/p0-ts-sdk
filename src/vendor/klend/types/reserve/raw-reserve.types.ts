import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import { BigFractionBytesFields, LastUpdateFields } from "../internal";

export interface ReserveRaw {
  /** Version of the reserve */
  version: BN;
  /** Last slot when supply and rates updated */
  lastUpdate: LastUpdateFields;
  /** Lending market address */
  lendingMarket: PublicKey;
  farmCollateral: PublicKey;
  farmDebt: PublicKey;
  /** Reserve liquidity */
  liquidity: ReserveLiquidityFields;
  reserveLiquidityPadding: Array<BN>;
  /** Reserve collateral */
  collateral: ReserveCollateralFields;
  reserveCollateralPadding: Array<BN>;
  /** Reserve configuration values */
  config: ReserveConfigFields;
  configPadding: Array<BN>;
  borrowedAmountOutsideElevationGroup: BN;
  /**
   * Amount of token borrowed in lamport of debt asset in the given
   * elevation group when this reserve is part of the collaterals.
   */
  borrowedAmountsAgainstThisReserveInElevationGroups: Array<BN>;
  padding: Array<BN>;
}

export interface ReserveLiquidityFields {
  /** Reserve liquidity mint address */
  mintPubkey: PublicKey;
  /** Reserve liquidity supply address */
  supplyVault: PublicKey;
  /** Reserve liquidity fee collection address */
  feeVault: PublicKey;
  /** Reserve liquidity available */
  availableAmount: BN;
  /** Reserve liquidity borrowed (scaled fraction) */
  borrowedAmountSf: BN;
  /** Reserve liquidity market price in quote currency (scaled fraction) */
  marketPriceSf: BN;
  /** Unix timestamp of the market price (from the oracle) */
  marketPriceLastUpdatedTs: BN;
  /** Reserve liquidity mint decimals */
  mintDecimals: BN;
  /**
   * Timestamp when the last refresh reserve detected that the liquidity amount is above the deposit cap. When this threshold is crossed, then redemptions (auto-deleverage) are enabled.
   * If the threshold is not crossed, then the timestamp is set to 0
   */
  depositLimitCrossedTimestamp: BN;
  /**
   * Timestamp when the last refresh reserve detected that the borrowed amount is above the borrow cap. When this threshold is crossed, then redemptions (auto-deleverage) are enabled.
   * If the threshold is not crossed, then the timestamp is set to 0
   */
  borrowLimitCrossedTimestamp: BN;
  /** Reserve liquidity cumulative borrow rate (scaled fraction) */
  cumulativeBorrowRateBsf: BigFractionBytesFields;
  /** Reserve cumulative protocol fees (scaled fraction) */
  accumulatedProtocolFeesSf: BN;
  /** Reserve cumulative referrer fees (scaled fraction) */
  accumulatedReferrerFeesSf: BN;
  /** Reserve pending referrer fees, to be claimed in refresh_obligation by referrer or protocol (scaled fraction) */
  pendingReferrerFeesSf: BN;
  /** Reserve referrer fee absolute rate calculated at each refresh_reserve operation (scaled fraction) */
  absoluteReferralRateSf: BN;
  /** Token program of the liquidity mint */
  tokenProgram: PublicKey;
  padding2: Array<BN>;
  padding3: Array<BN>;
}

export interface ReserveCollateralFields {
  /** Reserve collateral mint address */
  mintPubkey: PublicKey;
  /** Reserve collateral mint supply, used for exchange rate */
  mintTotalSupply: BN;
  /** Reserve collateral supply address */
  supplyVault: PublicKey;
  padding1: Array<BN>;
  padding2: Array<BN>;
}

export interface ReserveConfigFields {
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
  deleveragingMarginCallPeriodSecs: BN;
  /**
   * The rate at which the deleveraging threshold decreases, in bps per day.
   * Only relevant when `autodeleverage_enabled == 1`, and must not be 0 in such case.
   */
  deleveragingThresholdDecreaseBpsPerDay: BN;
  /** Program owner fees assessed, separate from gains due to interest accrual */
  fees: ReserveFeesFields;
  /** Borrow rate curve based on utilization */
  borrowRateCurve: BorrowRateCurveFields;
  /** Borrow factor in percentage - used for risk adjustment */
  borrowFactorPct: BN;
  /** Maximum deposit limit of liquidity in native units, u64::MAX for inf */
  depositLimit: BN;
  /** Maximum amount borrowed, u64::MAX for inf, 0 to disable borrows (protected deposits) */
  borrowLimit: BN;
  /** Token id from TokenInfos struct */
  tokenInfo: TokenInfoFields;
  /** Deposit withdrawal caps - deposit & redeem */
  depositWithdrawalCap: WithdrawalCapsFields;
  /** Debt withdrawal caps - borrow & repay */
  debtWithdrawalCap: WithdrawalCapsFields;
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
  borrowLimitOutsideElevationGroup: BN;
  /**
   * Defines the maximum amount (in lamports of elevation group debt asset)
   * that can be borrowed when this reserve is used as collateral.
   * - u64::MAX for inf
   * - 0 to disable borrows in this elevation group (expected value for the debt asset)
   */
  borrowLimitAgainstThisCollateralInElevationGroup: Array<BN>;
  /**
   * The rate at which the deleveraging-related liquidation bonus increases, in bps per day.
   * Only relevant when `autodeleverage_enabled == 1`, and must not be 0 in such case.
   */
  deleveragingBonusIncreaseBpsPerDay: BN;
}

export interface ReserveFeesFields {
  /**
   * Fee assessed on `BorrowObligationLiquidity`, as scaled fraction (60 bits fractional part)
   * Must be between `0` and `2^60`, such that `2^60 = 1`.  A few examples for
   * clarity:
   * 1% = (1 << 60) / 100 = 11529215046068470
   * 0.01% (1 basis point) = 115292150460685
   * 0.00001% (Aave borrow fee) = 115292150461
   */
  borrowFeeSf: BN;
  /**
   * Fee for flash loan, expressed as scaled fraction.
   * 0.3% (Aave flash loan fee) = 0.003 * 2^60 = 3458764513820541
   */
  flashLoanFeeSf: BN;
  /** Used for allignment */
  padding: Array<number>;
}

export interface BorrowRateCurveFields {
  points: Array<CurvePointFields>;
}

export interface CurvePointFields {
  utilizationRateBps: number;
  borrowRateBps: number;
}

export interface TokenInfoFields {
  /** UTF-8 encoded name of the token (null-terminated) */
  name: Array<number>;
  /** Heuristics limits of acceptable price */
  heuristic: PriceHeuristicFields;
  /** Max divergence between twap and price in bps */
  maxTwapDivergenceBps: BN;
  maxAgePriceSeconds: BN;
  maxAgeTwapSeconds: BN;
  /** Scope price configuration */
  scopeConfiguration: ScopeConfigurationFields;
  /** Switchboard configuration */
  switchboardConfiguration: SwitchboardConfigurationFields;
  /** Pyth configuration */
  pythConfiguration: PythConfigurationFields;
  blockPriceUsage: number;
  reserved: Array<number>;
  padding: Array<BN>;
}

export interface PriceHeuristicFields {
  /** Lower value of acceptable price */
  lower: BN;
  /** Upper value of acceptable price */
  upper: BN;
  /** Number of decimals of the previously defined values */
  exp: BN;
}

export interface ScopeConfigurationFields {
  /** Pubkey of the scope price feed (disabled if `null` or `default`) */
  priceFeed: PublicKey;
  /** This is the scope_id price chain that results in a price for the token */
  priceChain: Array<number>;
  /** This is the scope_id price chain for the twap */
  twapChain: Array<number>;
}

export interface SwitchboardConfigurationFields {
  /** Pubkey of the base price feed (disabled if `null` or `default`) */
  priceAggregator: PublicKey;
  twapAggregator: PublicKey;
}

export interface PythConfigurationFields {
  /** Pubkey of the base price feed (disabled if `null` or `default`) */
  price: PublicKey;
}

export interface WithdrawalCapsFields {
  configCapacity: BN;
  currentTotal: BN;
  lastIntervalStartTimestamp: BN;
  configIntervalLengthSeconds: BN;
}
