import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";

/**
 * Curated TokenReserve used throughout the codebase.
 *
 * Liquidity-layer reserve account for a mint. Contains supply/borrow
 * exchange prices, utilization, and totals.
 */
export interface JupTokenReserve {
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
