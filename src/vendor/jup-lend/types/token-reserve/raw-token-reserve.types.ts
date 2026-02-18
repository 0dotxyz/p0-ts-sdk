import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";

/**
 * Raw on-chain TokenReserve account (bytemuck / packed C repr).
 *
 * This lives on the jup liquidity layer and contains supply/borrow
 * exchange prices, utilization, and totals for a given token.
 */
export interface JupTokenReserveRaw {
  pubkey: PublicKey;
  mint: PublicKey;
  vault: PublicKey;
  borrowRate: number;
  feeOnInterest: number;
  lastUtilization: number;
  lastUpdateTimestamp: BN;
  supplyExchangePrice: BN;
  borrowExchangePrice: BN;
  maxUtilization: number;
  totalSupplyWithInterest: BN;
  totalSupplyInterestFree: BN;
  totalBorrowWithInterest: BN;
  totalBorrowInterestFree: BN;
  totalClaimAmount: BN;
  interactingProtocol: PublicKey;
  interactingTimestamp: BN;
  interactingBalance: BN;
}
