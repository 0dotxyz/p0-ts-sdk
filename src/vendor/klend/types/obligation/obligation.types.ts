import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";

/**
 * Curated Kamino Obligation used throughout the codebase.
 *
 * Keeps only the position data: owner, market, and the deposit/borrow
 * slots (fixed-size arrays on-chain, mapped 1:1 without filtering).
 */
export interface KaminoObligation {
  /** Lending market address */
  lendingMarket: PublicKey;
  /** Owner authority which can borrow liquidity */
  owner: PublicKey;
  /** Deposited collateral for the obligation, unique by deposit reserve address */
  deposits: Array<KaminoObligationCollateral>;
  /** Borrowed liquidity for the obligation, unique by borrow reserve address */
  borrows: Array<KaminoObligationLiquidity>;
}

export interface KaminoObligationCollateral {
  /** Reserve collateral is deposited to */
  depositReserve: PublicKey;
  /** Amount of collateral deposited */
  depositedAmount: BN;
  /** Collateral market value in quote currency (scaled fraction) */
  marketValueSf: BN;
}

export interface KaminoObligationLiquidity {
  /** Reserve liquidity is borrowed from */
  borrowReserve: PublicKey;
  /** Amount of liquidity borrowed plus interest (scaled fraction) */
  borrowedAmountSf: BN;
  /** Liquidity market value in quote currency (scaled fraction) */
  marketValueSf: BN;
}
