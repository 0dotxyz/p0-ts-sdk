/**
 * JSON-serializable DTO for the UserSupplyPosition account.
 * PublicKey → string, BN → string.
 */
export interface JupUserSupplyPositionJSON {
  pubkey: string;
  protocol: string;
  mint: string;
  withInterest: number;
  amount: string;
  withdrawalLimit: string;
  lastUpdate: string;
  expandPct: number;
  expandDuration: string;
  baseWithdrawalLimit: string;
  status: number;
}
