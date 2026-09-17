import type { Address } from "@solana/kit";

/**
 * Curated Kamino Reserve: the subset of the generated `Reserve` the SDK reads. A decoded `Reserve`
 * satisfies it structurally.
 */
export interface KaminoReserve {
  lendingMarket: Address;
  farmCollateral: Address;
  liquidity: KaminoReserveLiquidity;
  collateral: KaminoReserveCollateral;
  config: KaminoReserveConfig;
}

export interface KaminoReserveLiquidity {
  mintPubkey: Address;
  supplyVault: Address;
  mintDecimals: bigint;
  /** Liquid vault balance, native units */
  totalAvailableAmount: bigint;
  /** Scaled fraction */
  borrowedAmountSf: bigint;
  /** Scaled fraction */
  accumulatedProtocolFeesSf: bigint;
  /** Scaled fraction */
  accumulatedReferrerFeesSf: bigint;
  /** Scaled fraction; claimed in refresh_obligation by referrer or protocol */
  pendingReferrerFeesSf: bigint;
}

export interface KaminoReserveCollateral {
  mintPubkey: Address;
  /** cToken supply, used for the exchange rate */
  mintTotalSupply: bigint;
  supplyVault: Address;
}

/** On-chain `InterestRateBasis`, stored as the `u8` `ReserveConfig.interestRateBasis`. */
export enum KaminoInterestRateBasis {
  /** Nominal slot-year APRs (`SLOTS_PER_SECOND`); realized rate scales with slot duration. */
  Legacy = 0,
  /** Wall-clock APRs over `SECONDS_PER_YEAR`. All reserves created by klend >= 1.25.0. */
  TrueApr = 1,
}

export interface KaminoReserveConfig {
  /** Share of borrow interest kept by the protocol, percent */
  protocolTakeRatePct: number;
  hostFixedInterestRateBps: number;
  /** See {@link KaminoInterestRateBasis}; absent on DTOs serialized before it existed (= Legacy). */
  interestRateBasis?: number;
  /** Native units, u64::MAX for inf */
  depositLimit: bigint;
  /** Native units, u64::MAX for inf, 0 disables borrows */
  borrowLimit: bigint;
  borrowRateCurve: { points: Array<KaminoBorrowRateCurvePoint> };
  tokenInfo: KaminoReserveTokenInfo;
}

export interface KaminoBorrowRateCurvePoint {
  utilizationRateBps: number;
  borrowRateBps: number;
}

/** Oracle feeds; a feed is disabled when its address is the default or null address. */
export interface KaminoReserveTokenInfo {
  scopeConfiguration: { priceFeed: Address };
  switchboardConfiguration: { priceAggregator: Address; twapAggregator: Address };
  pythConfiguration: { price: Address };
}

/** Curated Kamino Obligation: owner, market and the fixed-size deposit/borrow slots. */
export interface KaminoObligation {
  lendingMarket: Address;
  owner: Address;
  deposits: Array<KaminoObligationCollateral>;
  borrows: Array<KaminoObligationLiquidity>;
}

export interface KaminoObligationCollateral {
  depositReserve: Address;
  /** cTokens */
  depositedAmount: bigint;
  /** Scaled fraction, quote currency */
  marketValueSf: bigint;
}

export interface KaminoObligationLiquidity {
  borrowReserve: Address;
  /** Scaled fraction, includes interest */
  borrowedAmountSf: bigint;
  /** Scaled fraction, quote currency */
  marketValueSf: bigint;
}

/** Curated Kamino FarmState: staked token and the reward schedules needed for reward APYs. */
export interface KaminoFarmState {
  token: KaminoFarmTokenInfo;
  rewardInfos: Array<KaminoFarmRewardInfo>;
}

export interface KaminoFarmTokenInfo {
  mint: Address;
  decimals: bigint;
}

export interface KaminoFarmRewardInfo {
  token: KaminoFarmTokenInfo;
  /** Rewards left in the rewards vault, native units */
  rewardsAvailable: bigint;
  rewardsPerSecondDecimals: number;
  /** Stepwise: each point's rate applies from its `tsStart` until the next point's. */
  rewardScheduleCurve: { points: Array<KaminoRewardCurvePoint> };
}

export interface KaminoRewardCurvePoint {
  tsStart: bigint;
  rewardPerTimeUnit: bigint;
}

/** JSON DTO of {@link KaminoReserve}: addresses and bigints as strings. */
export interface KaminoReserveJSON {
  lendingMarket: string;
  farmCollateral: string;
  liquidity: {
    mintPubkey: string;
    supplyVault: string;
    mintDecimals: string;
    totalAvailableAmount: string;
    borrowedAmountSf: string;
    accumulatedProtocolFeesSf: string;
    accumulatedReferrerFeesSf: string;
    pendingReferrerFeesSf: string;
  };
  collateral: {
    mintPubkey: string;
    mintTotalSupply: string;
    supplyVault: string;
  };
  config: {
    protocolTakeRatePct: number;
    hostFixedInterestRateBps: number;
    interestRateBasis?: number;
    depositLimit: string;
    borrowLimit: string;
    borrowRateCurve: { points: Array<KaminoBorrowRateCurvePoint> };
    tokenInfo: {
      scopeConfiguration: { priceFeed: string };
      switchboardConfiguration: { priceAggregator: string; twapAggregator: string };
      pythConfiguration: { price: string };
    };
  };
}

/** JSON DTO of {@link KaminoObligation}: addresses and bigints as strings. */
export interface KaminoObligationJSON {
  lendingMarket: string;
  owner: string;
  deposits: Array<{ depositReserve: string; depositedAmount: string; marketValueSf: string }>;
  borrows: Array<{ borrowReserve: string; borrowedAmountSf: string; marketValueSf: string }>;
}

/** JSON DTO of {@link KaminoFarmState}: addresses and bigints as strings. */
export interface KaminoFarmStateJSON {
  token: { mint: string; decimals: string };
  rewardInfos: Array<{
    token: { mint: string; decimals: string };
    rewardsAvailable: string;
    rewardsPerSecondDecimals: number;
    rewardScheduleCurve: { points: Array<{ tsStart: string; rewardPerTimeUnit: string }> };
  }>;
}
