import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";

export interface DriftSpotMarket {
  pubkey: PublicKey;
  oracle: PublicKey;
  mint: PublicKey;
  decimals: number;
  cumulativeDepositInterest: BN;
  marketIndex: number;

  // Additional fields needed for APY calculation
  depositBalance: BN;
  borrowBalance: BN;
  cumulativeBorrowInterest: BN;
  optimalUtilization: number;
  optimalBorrowRate: number;
  maxBorrowRate: number;
  minBorrowRate: number;
  insuranceFund: {
    totalFactor: number;
  };
}

export enum DriftSpotBalanceType {
  DEPOSIT = "deposit",
  BORROW = "borrow",
}

export function isSpotBalanceTypeVariant(
  value: DriftSpotBalanceType,
  variant: "deposit" | "borrow"
): boolean {
  return value === variant;
}
