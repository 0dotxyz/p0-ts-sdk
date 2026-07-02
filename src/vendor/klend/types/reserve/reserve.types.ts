import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";

/**
 * Curated Kamino Reserve used throughout the codebase.
 *
 * Contains only the fields the SDK reads: market/farm addresses, the
 * liquidity and collateral state needed for cToken exchange rates and
 * deposit/withdraw instructions, and the config subset used for interest
 * rates and oracle refreshes.
 */
export interface KaminoReserve {
  /** Lending market address */
  lendingMarket: PublicKey;
  farmCollateral: PublicKey;
  /** Reserve liquidity */
  liquidity: KaminoReserveLiquidity;
  /** Reserve collateral */
  collateral: KaminoReserveCollateral;
  /** Reserve configuration values */
  config: KaminoReserveConfig;
}

export interface KaminoReserveLiquidity {
  /** Reserve liquidity mint address */
  mintPubkey: PublicKey;
  /** Reserve liquidity supply address */
  supplyVault: PublicKey;
  /** Reserve liquidity mint decimals */
  mintDecimals: BN;
  /** Reserve liquidity available */
  availableAmount: BN;
  /** Reserve liquidity borrowed (scaled fraction) */
  borrowedAmountSf: BN;
  /** Reserve cumulative protocol fees (scaled fraction) */
  accumulatedProtocolFeesSf: BN;
  /** Reserve cumulative referrer fees (scaled fraction) */
  accumulatedReferrerFeesSf: BN;
  /** Reserve pending referrer fees, to be claimed in refresh_obligation by referrer or protocol (scaled fraction) */
  pendingReferrerFeesSf: BN;
}

export interface KaminoReserveCollateral {
  /** Reserve collateral mint address */
  mintPubkey: PublicKey;
  /** Reserve collateral mint supply, used for exchange rate */
  mintTotalSupply: BN;
  /** Reserve collateral supply address */
  supplyVault: PublicKey;
}

export interface KaminoReserveConfig {
  /** Protocol take rate is the amount borrowed interest protocol receives, as a percentage */
  protocolTakeRatePct: number;
  /** Flat rate that goes to the host */
  hostFixedInterestRateBps: number;
  /** Borrow rate curve based on utilization */
  borrowRateCurve: KaminoBorrowRateCurve;
  /** Oracle configurations */
  tokenInfo: KaminoReserveTokenInfo;
}

export interface KaminoBorrowRateCurve {
  points: Array<KaminoBorrowRateCurvePoint>;
}

export interface KaminoBorrowRateCurvePoint {
  utilizationRateBps: number;
  borrowRateBps: number;
}

export interface KaminoReserveTokenInfo {
  /** Scope price configuration */
  scopeConfiguration: KaminoScopeConfiguration;
  /** Switchboard configuration */
  switchboardConfiguration: KaminoSwitchboardConfiguration;
  /** Pyth configuration */
  pythConfiguration: KaminoPythConfiguration;
}

export interface KaminoScopeConfiguration {
  /** Pubkey of the scope price feed (disabled if `null` or `default`) */
  priceFeed: PublicKey;
}

export interface KaminoSwitchboardConfiguration {
  /** Pubkey of the base price feed (disabled if `null` or `default`) */
  priceAggregator: PublicKey;
  twapAggregator: PublicKey;
}

export interface KaminoPythConfiguration {
  /** Pubkey of the base price feed (disabled if `null` or `default`) */
  price: PublicKey;
}
