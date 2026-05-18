import { KaminoReserveBorrowRateCurve } from "./reserve.types";

/**
 * JSON-friendly counterpart of {@link KaminoReserve} and friends. PublicKey
 * fields become base58 strings, BN fields become decimal strings.
 */
export interface KaminoReserveLiquidityDto {
  mintPubkey: string;
  mintDecimals: string;
  availableAmount: string;
  borrowedAmountSf: string;
  accumulatedProtocolFeesSf: string;
  accumulatedReferrerFeesSf: string;
  pendingReferrerFeesSf: string;
  supplyVault: string;
}

export interface KaminoReserveCollateralDto {
  mintPubkey: string;
  mintTotalSupply: string;
  supplyVault: string;
}

export interface KaminoReserveConfigTokenInfoDto {
  pythConfiguration: { price: string };
  switchboardConfiguration: { priceAggregator: string; twapAggregator: string };
  scopeConfiguration: { priceFeed: string };
}

export interface KaminoReserveConfigDto {
  hostFixedInterestRateBps: number;
  protocolTakeRatePct: number;
  borrowRateCurve: KaminoReserveBorrowRateCurve;
  depositLimit: string;
  borrowLimit: string;
  tokenInfo: KaminoReserveConfigTokenInfoDto;
}

export interface KaminoReserveDto {
  lendingMarket: string;
  farmCollateral: string;
  liquidity: KaminoReserveLiquidityDto;
  collateral: KaminoReserveCollateralDto;
  config: KaminoReserveConfigDto;
}
