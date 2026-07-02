/**
 * JSON-serializable DTOs for the curated Kamino Obligation.
 * PublicKey → string, BN → string.
 */
export interface KaminoObligationJSON {
  lendingMarket: string;
  owner: string;
  deposits: Array<KaminoObligationCollateralJSON>;
  borrows: Array<KaminoObligationLiquidityJSON>;
}

export interface KaminoObligationCollateralJSON {
  depositReserve: string;
  depositedAmount: string;
  marketValueSf: string;
}

export interface KaminoObligationLiquidityJSON {
  borrowReserve: string;
  borrowedAmountSf: string;
  marketValueSf: string;
}
