import type { Address, ReadonlyUint8Array } from "@solana/kit";

import type { SpotBalanceType } from "~/generated/drift";

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

/** A Drift spot position: a deposit or borrow in one spot market. */
export interface DriftSpotPosition {
  /** Scaled balance, precision SPOT_BALANCE_PRECISION (1e9); token amount = × cumulative interest */
  scaledBalance: bigint;
  /** Open spot bids, token mint precision */
  openBids: bigint;
  /** Open spot asks, token mint precision */
  openAsks: bigint;
  /** Net deposits minus withdrawals, token mint precision */
  cumulativeDeposits: bigint;
  marketIndex: number;
  balanceType: SpotBalanceType;
  openOrders: number;
  padding: ReadonlyUint8Array;
}

/** Curated Drift `User`: the authority and its spot positions. */
export interface DriftUser {
  authority: Address;
  spotPositions: DriftSpotPosition[];
}

/** Drift `UserFees`, native quote units. */
export interface DriftUserFees {
  totalFeePaid: bigint;
  totalFeeRebate: bigint;
  totalTokenDiscount: bigint;
  totalRefereeDiscount: bigint;
  totalReferrerReward: bigint;
  currentEpochReferrerReward: bigint;
}

/** Drift `UserStats` (volumes, fees, fuel) without its discriminator. */
export interface DriftUserStats {
  authority: Address;
  referrer: Address;
  fees: DriftUserFees;
  nextEpochTs: bigint;
  makerVolume30d: bigint;
  takerVolume30d: bigint;
  fillerVolume30d: bigint;
  lastMakerVolume30dTs: bigint;
  lastTakerVolume30dTs: bigint;
  lastFillerVolume30dTs: bigint;
  ifStakedQuoteAssetAmount: bigint;
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
  ifStakedGovTokenAmount: bigint;
  lastFuelIfBonusUpdateTs: number;
  padding: ReadonlyUint8Array;
}

/** A Drift reward: a spot position the program credited to the bank's Drift user. */
export interface DriftRewards {
  oracle: Address;
  marketIndex: number;
  spotMarket: Address;
  mint: Address;
  spotPosition: DriftSpotPosition;
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

/** A marginfi Drift bank's venue accounts (its integration accounts 1 and 2). */
export interface DriftBankInput {
  bankAddress: Address;
  spotMarket: Address;
  user: Address;
}

/** A Drift bank's venue state: its spot market, its Drift user and the rewards credited to that user. */
export interface DriftStates {
  spotMarketState: DriftSpotMarket;
  userState: DriftUser;
  userRewards: DriftRewards[];
}

/** JSON DTO of {@link DriftStates}. */
export interface DriftStatesJSON {
  spotMarketState: DriftSpotMarketJSON;
  userState: DriftUserJSON;
  userRewards: DriftRewardsJSON[];
}
