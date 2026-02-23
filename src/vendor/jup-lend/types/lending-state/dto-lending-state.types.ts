/**
 * JSON-serializable DTO for the Lending account.
 * PublicKey → string, BN → string.
 */
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
