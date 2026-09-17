import type { Address } from "@solana/kit";

/**
 * Curated JupLend `Lending` account (the bank's integration_acc_1): fToken ↔ underlying exchange
 * prices, analogous to a Kamino Reserve.
 */
export interface JupLendingState {
  pubkey: Address;
  mint: Address;
  fTokenMint: Address;
  lendingId: number;
  decimals: number;
  rewardsRateModel: Address;
  /** Underlying asset exchange price in the liquidity layer, without rewards (1e12 precision) */
  liquidityExchangePrice: bigint;
  /** fToken ↔ underlying exchange price, with rewards (1e12 precision) */
  tokenExchangePrice: bigint;
  /** Unix seconds */
  lastUpdateTimestamp: bigint;
  tokenReservesLiquidity: Address;
  supplyPositionOnLiquidity: Address;
}

/** Curated liquidity-layer `TokenReserve`: supply/borrow exchange prices, utilization and totals. */
export interface JupTokenReserve {
  pubkey: Address;
  /** Bps */
  borrowRate: number;
  /** Bps */
  feeOnInterest: number;
  /** Bps */
  lastUtilization: number;
  supplyExchangePrice: bigint;
  borrowExchangePrice: bigint;
  totalSupplyWithInterest: bigint;
  totalSupplyInterestFree: bigint;
  totalBorrowWithInterest: bigint;
  totalBorrowInterestFree: bigint;
}

/** Curated `LendingRewardsRateModel`: rewards distribution parameters of a market. */
export interface JupLendingRewardsRateModel {
  /** TVL (native units) below which the rewards rate is 0 */
  startTvl: bigint;
  /** Seconds the current rewards run */
  duration: bigint;
  /** Unix seconds */
  startTime: bigint;
  /** Annualized reward, native units */
  yearlyReward: bigint;
}

/**
 * Curated liquidity-layer `RateModel`, all values in bps. Version 1 has one kink
 * (zero → kink1 → max), version 2 two (zero → kink1 → kink2 → max).
 */
export interface JupRateModel {
  version: number;
  rateAtZero: number;
  kink1Utilization: number;
  rateAtKink1: number;
  rateAtMax: number;
  kink2Utilization: number;
  rateAtKink2: number;
}

/** JSON DTO of {@link JupLendingState}: addresses and bigints as strings. */
export interface JupLendingStateJSON {
  pubkey: string;
  mint: string;
  fTokenMint: string;
  lendingId: number;
  decimals: number;
  rewardsRateModel: string;
  liquidityExchangePrice: string;
  tokenExchangePrice: string;
  lastUpdateTimestamp: string;
  tokenReservesLiquidity: string;
  supplyPositionOnLiquidity: string;
  bump?: number;
}

/** JSON DTO of {@link JupTokenReserve}: addresses and bigints as strings. */
export interface JupTokenReserveJSON {
  pubkey: string;
  borrowRate: number;
  feeOnInterest: number;
  lastUtilization: number;
  supplyExchangePrice: string;
  borrowExchangePrice: string;
  totalSupplyWithInterest: string;
  totalSupplyInterestFree: string;
  totalBorrowWithInterest: string;
  totalBorrowInterestFree: string;
}

/** JSON DTO of {@link JupLendingRewardsRateModel}: bigints as strings. */
export interface JupLendingRewardsRateModelJSON {
  startTvl: string;
  duration: string;
  startTime: string;
  yearlyReward: string;
}

/** JSON DTO of {@link JupRateModel}. */
export type JupRateModelJSON = JupRateModel;
