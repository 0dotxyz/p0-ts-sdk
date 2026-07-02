/**
 * JSON-serializable DTOs for the curated Kamino Reserve.
 * PublicKey → string, BN → string.
 */
export interface KaminoReserveJSON {
  lendingMarket: string;
  farmCollateral: string;
  liquidity: KaminoReserveLiquidityJSON;
  collateral: KaminoReserveCollateralJSON;
  config: KaminoReserveConfigJSON;
}

export interface KaminoReserveLiquidityJSON {
  mintPubkey: string;
  supplyVault: string;
  mintDecimals: string;
  availableAmount: string;
  borrowedAmountSf: string;
  accumulatedProtocolFeesSf: string;
  accumulatedReferrerFeesSf: string;
  pendingReferrerFeesSf: string;
}

export interface KaminoReserveCollateralJSON {
  mintPubkey: string;
  mintTotalSupply: string;
  supplyVault: string;
}

export interface KaminoReserveConfigJSON {
  protocolTakeRatePct: number;
  hostFixedInterestRateBps: number;
  borrowRateCurve: KaminoBorrowRateCurveJSON;
  tokenInfo: KaminoReserveTokenInfoJSON;
}

export interface KaminoBorrowRateCurveJSON {
  points: Array<KaminoBorrowRateCurvePointJSON>;
}

export interface KaminoBorrowRateCurvePointJSON {
  utilizationRateBps: number;
  borrowRateBps: number;
}

export interface KaminoReserveTokenInfoJSON {
  scopeConfiguration: KaminoScopeConfigurationJSON;
  switchboardConfiguration: KaminoSwitchboardConfigurationJSON;
  pythConfiguration: KaminoPythConfigurationJSON;
}

export interface KaminoScopeConfigurationJSON {
  priceFeed: string;
}

export interface KaminoSwitchboardConfigurationJSON {
  priceAggregator: string;
  twapAggregator: string;
}

export interface KaminoPythConfigurationJSON {
  price: string;
}
