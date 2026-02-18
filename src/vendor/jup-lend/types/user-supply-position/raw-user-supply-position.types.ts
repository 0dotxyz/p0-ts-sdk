import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";

/**
 * Raw on-chain UserSupplyPosition account (bytemuck / packed C repr).
 *
 * Tracks a user's supply position for a given protocol and mint.
 */
export interface JupUserSupplyPositionRaw {
  pubkey: PublicKey;
  protocol: PublicKey;
  mint: PublicKey;
  withInterest: number;
  amount: BN;
  withdrawalLimit: BN;
  lastUpdate: BN;
  expandPct: number;
  expandDuration: BN;
  baseWithdrawalLimit: BN;
  status: number;
}
