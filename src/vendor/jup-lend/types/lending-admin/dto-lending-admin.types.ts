/**
 * JSON-serializable DTO for the LendingAdmin account.
 * PublicKey → string.
 */
export interface JupLendingAdminJSON {
  pubkey: string;
  authority: string;
  liquidityProgram: string;
  rebalancer: string;
  nextLendingId: number;
  auths: string[];
  bump: number;
}
