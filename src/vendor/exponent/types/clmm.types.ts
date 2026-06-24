import {
  AccountMeta,
  AddressLookupTableAccount,
  Connection,
  PublicKey,
} from "@solana/web3.js";

import { ExponentCpiInterfaceContext } from "./market.types";

/**
 * The SY-program CPI account lists a CLMM `trade_pt` appends as remaining accounts.
 * Order (from the SDK's `ixTradePt`): `getSyState` ++ `getPositionState` ++ `depositSy`
 * ++ `withdrawSy`, then de-duplicated. Each is referenced by an index into the market's
 * address lookup table.
 */
export interface ExponentMarketThreeCpiAccounts {
  getSyState: ExponentCpiInterfaceContext[];
  getPositionState: ExponentCpiInterfaceContext[];
  depositSy: ExponentCpiInterfaceContext[];
  withdrawSy: ExponentCpiInterfaceContext[];
}

/** The subset of an Exponent `MarketThree` (CLMM) pool account that `trade_pt` needs. */
export interface ExponentMarketThree {
  /** The pool's own address (`self_address` / the account key). */
  selfAddress: PublicKey;
  mintPt: PublicKey;
  mintSy: PublicKey;
  vault: PublicKey;
  /** The single `ticks` account holding the pool's tick tree (not per-tick-array accounts). */
  ticks: PublicKey;
  /** Pool PT liquidity escrow (`token_pt_escrow`). */
  tokenPtEscrow: PublicKey;
  /** Pool SY liquidity escrow (`token_sy_escrow`). */
  tokenSyEscrow: PublicKey;
  /** SY account holding treasury fees (`token_fee_treasury_sy`). */
  tokenFeeTreasurySy: PublicKey;
  /** PT account holding treasury fees (`token_fee_treasury_pt`). */
  tokenFeeTreasuryPt: PublicKey;
  addressLookupTable: PublicKey;
  syProgram: PublicKey;
  statusFlags: number;
  /** SY-program CPI account lists, referenced by ALT index. */
  cpiAccounts: ExponentMarketThreeCpiAccounts;
}

/**
 * `SwapDirection` arg of the CLMM `trade_pt` instruction (a `u8`). `SyToPt` buys PT with
 * SY (the roll's buy leg); `PtToSy` sells PT for SY.
 */
export enum ExponentSwapDirection {
  PtToSy = 0,
  SyToPt = 1,
}

/**
 * Accounts required by the CLMM `trade_pt`. The first 14 are the fixed
 * `#[derive(Accounts)]` accounts; `remainingAccounts` are the SY-program CPI accounts
 * (already resolved from the market ALT and de-duplicated).
 */
export interface ExponentClmmTradePtAccounts {
  /** Trader / signer (the marginfi account authority). */
  trader: PublicKey;
  /** The `MarketThree` (CLMM pool) address. */
  market: PublicKey;
  /** The pool's `ticks` account. */
  ticks: PublicKey;
  /** Trader's SY token account (source of the SY spent buying PT). */
  tokenSyTrader: PublicKey;
  /** Trader's PT token account (destination of the bought PT). */
  tokenPtTrader: PublicKey;
  /** `MarketThree.token_sy_escrow`. */
  tokenSyEscrow: PublicKey;
  /** `MarketThree.token_pt_escrow`. */
  tokenPtEscrow: PublicKey;
  /** `MarketThree.address_lookup_table`. */
  addressLookupTable: PublicKey;
  /** `MarketThree.sy_program`. */
  syProgram: PublicKey;
  /** `MarketThree.token_fee_treasury_sy`. */
  tokenFeeTreasurySy: PublicKey;
  /** `MarketThree.token_fee_treasury_pt`. */
  tokenFeeTreasuryPt: PublicKey;
  /** SPL token program for the PT/SY mints (defaults to the classic Token program). */
  tokenProgram?: PublicKey;
  /**
   * SY-program CPI accounts (`getSyState` ++ `getPositionState` ++ `depositSy` ++
   * `withdrawSy`, de-duplicated), pubkeys already resolved from the market ALT. Appended
   * after the 14 fixed accounts.
   */
  remainingAccounts: AccountMeta[];
}

export interface ResolveExponentClmmTradePtContextParams {
  connection: Connection;
  /** Trader / signer (the marginfi account authority). */
  owner: PublicKey;
  /** The successor maturity's `MarketThree` (CLMM pool) where the new PT trades. */
  market: PublicKey;
  /** Token program for the PT mint (Exponent uses the classic Token program). */
  ptTokenProgram?: PublicKey;
  /** Token program for the SY mint. Defaults to classic Token. */
  syTokenProgram?: PublicKey;
}

/**
 * Resolved inputs for a native CLMM `trade_pt` (SY → PT) on an Exponent `MarketThree`:
 * the fully-resolved `trade_pt` accounts (including the ALT-derived SY-CPI remaining
 * accounts), the market ALT to add to the transaction's lookup tables, and the SY/PT
 * token info. Feed `tradePtAccounts` + `addressLookupTable` into the roll's buy leg.
 */
export interface ExponentClmmTradePtContext {
  marketAddress: PublicKey;
  market: ExponentMarketThree;
  tradePtAccounts: ExponentClmmTradePtAccounts;
  /** The market's address lookup table account — must be carried by the transaction. */
  addressLookupTable: AddressLookupTableAccount;
  sy: { mint: PublicKey; decimals: number; tokenProgram: PublicKey };
  pt: { mint: PublicKey; decimals: number; tokenProgram: PublicKey };
}
