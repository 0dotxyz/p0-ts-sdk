import { PublicKey } from "@solana/web3.js";

/**
 * Raw on-chain LendingAdmin account.
 *
 * Global admin configuration for the jup-lend program.
 */
export interface JupLendingAdminRaw {
  pubkey: PublicKey;
  authority: PublicKey;
  liquidityProgram: PublicKey;
  rebalancer: PublicKey;
  nextLendingId: number;
  auths: PublicKey[];
  bump: number;
}
