/**
 * JSON-serializable DTO for the curated TokenReserve.
 * PublicKey → string, BN → string.
 */
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
