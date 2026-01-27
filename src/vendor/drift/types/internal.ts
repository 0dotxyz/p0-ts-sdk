import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";

// Fee Structure Types
export interface FeeStructure {
  feeTiers: Array<FeeTier>;
  fillerRewardStructure: OrderFillerRewardStructure;
  referrerRewardEpochUpperBound: BN;
  flatFillerFee: BN;
}

export interface FeeStructureJSON {
  feeTiers: Array<FeeTierJSON>;
  fillerRewardStructure: OrderFillerRewardStructureJSON;
  referrerRewardEpochUpperBound: string;
  flatFillerFee: string;
}

export interface FeeTier {
  feeNumerator: number;
  feeDenominator: number;
  makerRebateNumerator: number;
  makerRebateDenominator: number;
  referrerRewardNumerator: number;
  referrerRewardDenominator: number;
  refereeFeeNumerator: number;
  refereeFeeDenominator: number;
}

export interface FeeTierJSON {
  feeNumerator: number;
  feeDenominator: number;
  makerRebateNumerator: number;
  makerRebateDenominator: number;
  referrerRewardNumerator: number;
  referrerRewardDenominator: number;
  refereeFeeNumerator: number;
  refereeFeeDenominator: number;
}

export interface OrderFillerRewardStructure {
  rewardNumerator: number;
  rewardDenominator: number;
  timeBasedRewardLowerBound: BN;
}

export interface OrderFillerRewardStructureJSON {
  rewardNumerator: number;
  rewardDenominator: number;
  timeBasedRewardLowerBound: string;
}

// Oracle Guard Rails Types
export interface OracleGuardRails {
  priceDivergence: PriceDivergenceGuardRails;
  validity: ValidityGuardRails;
}

export interface OracleGuardRailsJSON {
  priceDivergence: PriceDivergenceGuardRailsJSON;
  validity: ValidityGuardRailsJSON;
}

export interface PriceDivergenceGuardRails {
  markOraclePercentDivergence: BN;
  oracleTwap5minPercentDivergence: BN;
}

export interface PriceDivergenceGuardRailsJSON {
  markOraclePercentDivergence: string;
  oracleTwap5minPercentDivergence: string;
}

export interface ValidityGuardRails {
  slotsBeforeStaleForAmm: BN;
  slotsBeforeStaleForMargin: BN;
  confidenceIntervalMaxSize: BN;
  tooVolatileRatio: BN;
}

export interface ValidityGuardRailsJSON {
  slotsBeforeStaleForAmm: string;
  slotsBeforeStaleForMargin: string;
  confidenceIntervalMaxSize: string;
  tooVolatileRatio: string;
}

// Historical Data Types
export interface HistoricalOracleData {
  /** precision: PRICE_PRECISION */
  lastOraclePrice: BN;
  /** precision: PRICE_PRECISION */
  lastOracleConf: BN;
  /** number of slots since last update */
  lastOracleDelay: BN;
  /** precision: PRICE_PRECISION */
  lastOraclePriceTwap: BN;
  /** precision: PRICE_PRECISION */
  lastOraclePriceTwap5min: BN;
  /** unix_timestamp of last snapshot */
  lastOraclePriceTwapTs: BN;
}

export interface HistoricalOracleDataJSON {
  /** precision: PRICE_PRECISION */
  lastOraclePrice: string;
  /** precision: PRICE_PRECISION */
  lastOracleConf: string;
  /** number of slots since last update */
  lastOracleDelay: string;
  /** precision: PRICE_PRECISION */
  lastOraclePriceTwap: string;
  /** precision: PRICE_PRECISION */
  lastOraclePriceTwap5min: string;
  /** unix_timestamp of last snapshot */
  lastOraclePriceTwapTs: string;
}

export interface HistoricalIndexData {
  /** precision: PRICE_PRECISION */
  lastIndexBidPrice: BN;
  /** precision: PRICE_PRECISION */
  lastIndexAskPrice: BN;
  /** precision: PRICE_PRECISION */
  lastIndexPriceTwap: BN;
  /** precision: PRICE_PRECISION */
  lastIndexPriceTwap5min: BN;
  /** unix_timestamp of last snapshot */
  lastIndexPriceTwapTs: BN;
}

export interface HistoricalIndexDataJSON {
  /** precision: PRICE_PRECISION */
  lastIndexBidPrice: string;
  /** precision: PRICE_PRECISION */
  lastIndexAskPrice: string;
  /** precision: PRICE_PRECISION */
  lastIndexPriceTwap: string;
  /** precision: PRICE_PRECISION */
  lastIndexPriceTwap5min: string;
  /** unix_timestamp of last snapshot */
  lastIndexPriceTwapTs: string;
}

// Pool and Insurance Types
export interface PoolBalance {
  /**
   * To get the pool's token amount, you must multiply the scaled balance by the market's cumulative
   * deposit interest
   * precision: SPOT_BALANCE_PRECISION
   */
  scaledBalance: BN;
  /** The spot market the pool is for */
  marketIndex: number;
  padding: Array<number>;
}

export interface PoolBalanceJSON {
  /**
   * To get the pool's token amount, you must multiply the scaled balance by the market's cumulative
   * deposit interest
   * precision: SPOT_BALANCE_PRECISION
   */
  scaledBalance: string;
  /** The spot market the pool is for */
  marketIndex: number;
  padding: Array<number>;
}

export interface InsuranceFund {
  vault: PublicKey;
  totalShares: BN;
  userShares: BN;
  sharesBase: BN;
  unstakingPeriod: BN;
  lastRevenueSettleTs: BN;
  revenueSettlePeriod: BN;
  totalFactor: number;
  userFactor: number;
}

export interface InsuranceFundJSON {
  vault: string;
  totalShares: string;
  userShares: string;
  sharesBase: string;
  unstakingPeriod: string;
  lastRevenueSettleTs: string;
  revenueSettlePeriod: string;
  totalFactor: number;
  userFactor: number;
}

// Spot Position Types
export enum SpotBalanceType {
  Deposit = "Deposit",
  Borrow = "Borrow",
}

export interface SpotPosition {
  /**
   * The scaled balance of the position. To get the token amount, multiply by the cumulative deposit/borrow
   * interest of corresponding market.
   * precision: SPOT_BALANCE_PRECISION
   */
  scaledBalance: BN;
  /**
   * How many spot bids the user has open
   * precision: token mint precision
   */
  openBids: BN;
  /**
   * How many spot asks the user has open
   * precision: token mint precision
   */
  openAsks: BN;
  /**
   * The cumulative deposits/borrows a user has made into a market
   * precision: token mint precision
   */
  cumulativeDeposits: BN;
  /** The market index of the corresponding spot market */
  marketIndex: number;
  /** Whether the position is deposit or borrow */
  balanceType: SpotBalanceType;
  /** Number of open orders */
  openOrders: number;
  padding: Array<number>;
}

export interface SpotPositionJSON {
  /**
   * The scaled balance of the position. To get the token amount, multiply by the cumulative deposit/borrow
   * interest of corresponding market.
   * precision: SPOT_BALANCE_PRECISION
   */
  scaledBalance: string;
  /**
   * How many spot bids the user has open
   * precision: token mint precision
   */
  openBids: string;
  /**
   * How many spot asks the user has open
   * precision: token mint precision
   */
  openAsks: string;
  /**
   * The cumulative deposits/borrows a user has made into a market
   * precision: token mint precision
   */
  cumulativeDeposits: string;
  /** The market index of the corresponding spot market */
  marketIndex: number;
  /** Whether the position is deposit or borrow */
  balanceType: SpotBalanceType;
  /** Number of open orders */
  openOrders: number;
  padding: Array<number>;
}
