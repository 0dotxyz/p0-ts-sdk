import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";

/**
 * Slim subset of {@link ReserveRaw} containing only the fields used by the
 * app and the Kamino vendor utility functions. Use this in all stored state
 * structures; the full `ReserveRaw` is only needed by low-level decoders and
 * the refresh instruction builder.
 */
export interface KaminoReserveLiquidity {
  mintPubkey: PublicKey;
  mintDecimals: BN;
  availableAmount: BN;
  borrowedAmountSf: BN;
  accumulatedProtocolFeesSf: BN;
  accumulatedReferrerFeesSf: BN;
  pendingReferrerFeesSf: BN;
  supplyVault: PublicKey;
}

export interface KaminoReserveCollateral {
  mintPubkey: PublicKey;
  mintTotalSupply: BN;
  supplyVault: PublicKey;
}

export interface KaminoReserveBorrowRatePoint {
  utilizationRateBps: number;
  borrowRateBps: number;
}

export interface KaminoReserveBorrowRateCurve {
  points: Array<KaminoReserveBorrowRatePoint>;
}

export interface KaminoReserveConfigTokenInfo {
  pythConfiguration: { price: PublicKey };
  switchboardConfiguration: { priceAggregator: PublicKey; twapAggregator: PublicKey };
  scopeConfiguration: { priceFeed: PublicKey };
}

export interface KaminoReserveConfig {
  hostFixedInterestRateBps: number;
  protocolTakeRatePct: number;
  borrowRateCurve: KaminoReserveBorrowRateCurve;
  depositLimit: BN;
  borrowLimit: BN;
  tokenInfo: KaminoReserveConfigTokenInfo;
}

export interface KaminoReserve {
  lendingMarket: PublicKey;
  farmCollateral: PublicKey;
  liquidity: KaminoReserveLiquidity;
  collateral: KaminoReserveCollateral;
  config: KaminoReserveConfig;
}
