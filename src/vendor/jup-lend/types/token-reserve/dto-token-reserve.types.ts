/**
 * JSON-serializable DTO for the TokenReserve account.
 * PublicKey → string, BN → string.
 */
export interface JupTokenReserveJSON {
  pubkey: string;
  mint: string;
  vault: string;
  borrowRate: number;
  feeOnInterest: number;
  lastUtilization: number;
  lastUpdateTimestamp: string;
  supplyExchangePrice: string;
  borrowExchangePrice: string;
  maxUtilization: number;
  totalSupplyWithInterest: string;
  totalSupplyInterestFree: string;
  totalBorrowWithInterest: string;
  totalBorrowInterestFree: string;
  totalClaimAmount: string;
  interactingProtocol: string;
  interactingTimestamp: string;
  interactingBalance: string;
}
