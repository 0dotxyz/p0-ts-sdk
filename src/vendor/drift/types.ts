import type { Address } from "@solana/kit";

import type { SpotBalanceType, SpotPosition, UserStats } from "~/generated/drift";

/** Curated Drift `SpotMarket`: the fields used for token amounts, rates and labeling. */
export interface DriftSpotMarket {
  pubkey: Address;
  oracle: Address;
  mint: Address;
  decimals: number;
  marketIndex: number;
  /** Precision: SPOT_CUMULATIVE_INTEREST_PRECISION (1e10) */
  cumulativeDepositInterest: bigint;
  /** Precision: SPOT_CUMULATIVE_INTEREST_PRECISION (1e10) */
  cumulativeBorrowInterest: bigint;
  /** Scaled balance, precision SPOT_BALANCE_PRECISION (1e9) */
  depositBalance: bigint;
  /** Scaled balance, precision SPOT_BALANCE_PRECISION (1e9) */
  borrowBalance: bigint;
  /** Precision: SPOT_MARKET_UTILIZATION_PRECISION (1e6) */
  optimalUtilization: number;
  /** Precision: SPOT_MARKET_RATE_PRECISION (1e6) */
  optimalBorrowRate: number;
  /** Precision: SPOT_MARKET_RATE_PRECISION (1e6) */
  maxBorrowRate: number;
  /** Precision: 0.5% steps (value × PERCENTAGE_PRECISION / 200) */
  minBorrowRate: number;
  insuranceFund: { totalFactor: number };
  /** Market pool (Main, JLP, LST, …) */
  poolId: number;
}

/** Curated Drift `User`: the authority and its spot positions. */
export interface DriftUser {
  authority: Address;
  spotPositions: SpotPosition[];
}

/** Drift `UserStats` without its discriminator. */
export type DriftUserStats = Omit<UserStats, "discriminator">;

/** A Drift reward: a spot position the program credited to the bank's Drift user. */
export interface DriftRewards {
  oracle: Address;
  marketIndex: number;
  spotMarket: Address;
  mint: Address;
  spotPosition: SpotPosition;
}

/** JSON DTO of a Drift `SpotPosition`: bigints as strings, padding as numbers. */
export interface DriftSpotPositionJSON {
  scaledBalance: string;
  openBids: string;
  openAsks: string;
  cumulativeDeposits: string;
  marketIndex: number;
  balanceType: SpotBalanceType;
  openOrders: number;
  padding: number[];
}

/** JSON DTO of {@link DriftSpotMarket}. */
export interface DriftSpotMarketJSON {
  pubkey: string;
  oracle: string;
  mint: string;
  decimals: number;
  marketIndex: number;
  cumulativeDepositInterest: string;
  cumulativeBorrowInterest: string;
  depositBalance: string;
  borrowBalance: string;
  optimalUtilization: number;
  optimalBorrowRate: number;
  maxBorrowRate: number;
  minBorrowRate: number;
  insuranceFund: { totalFactor: number };
  poolId: number;
}

/** JSON DTO of {@link DriftUser}. */
export interface DriftUserJSON {
  authority: string;
  spotPositions: DriftSpotPositionJSON[];
}

/** JSON DTO of {@link DriftRewards}. */
export interface DriftRewardsJSON {
  oracle: string;
  marketIndex: number;
  spotMarket: string;
  mint: string;
  spotPosition: DriftSpotPositionJSON;
}

/** JSON DTO of {@link DriftUserStats}: addresses and bigints as strings, padding as numbers. */
export interface DriftUserStatsJSON {
  authority: string;
  referrer: string;
  fees: {
    totalFeePaid: string;
    totalFeeRebate: string;
    totalTokenDiscount: string;
    totalRefereeDiscount: string;
    totalReferrerReward: string;
    currentEpochReferrerReward: string;
  };
  nextEpochTs: string;
  makerVolume30d: string;
  takerVolume30d: string;
  fillerVolume30d: string;
  lastMakerVolume30dTs: string;
  lastTakerVolume30dTs: string;
  lastFillerVolume30dTs: string;
  ifStakedQuoteAssetAmount: string;
  numberOfSubAccounts: number;
  numberOfSubAccountsCreated: number;
  referrerStatus: number;
  disableUpdatePerpBidAskTwap: number;
  pausedOperations: number;
  fuelOverflowStatus: number;
  fuelInsurance: number;
  fuelDeposits: number;
  fuelBorrows: number;
  fuelPositions: number;
  fuelTaker: number;
  fuelMaker: number;
  ifStakedGovTokenAmount: string;
  lastFuelIfBonusUpdateTs: number;
  padding: number[];
}
