import {
  AccountMeta,
  AddressLookupTableAccount,
  Connection,
  PublicKey,
} from "@solana/web3.js";

/**
 * An Exponent `CpiInterfaceContext` — one SY-program account a `trade_pt` CPI needs,
 * referenced by its index into the **market's address lookup table** (not an inline
 * pubkey). `resolveExponentTradePtContext` turns these into concrete {@link AccountMeta}s.
 */
export interface ExponentCpiInterfaceContext {
  /** Index into the market's address lookup table. */
  altIndex: number;
  isSigner: boolean;
  isWritable: boolean;
}

/**
 * The SY-program CPI account lists that `trade_pt` appends as remaining accounts
 * (order: `getSyState` ++ `depositSy` ++ `withdrawSy`). Pricing PT reads the SY rate
 * on-chain, so the trade must carry the flavor's SY-state/deposit/withdraw accounts.
 */
export interface ExponentMarketTwoCpiAccounts {
  getSyState: ExponentCpiInterfaceContext[];
  depositSy: ExponentCpiInterfaceContext[];
  withdrawSy: ExponentCpiInterfaceContext[];
}

/** The subset of an Exponent `MarketTwo` account that `trade_pt` needs. */
export interface ExponentMarketTwo {
  /** The market's own address (`self_address`). */
  selfAddress: PublicKey;
  mintPt: PublicKey;
  mintSy: PublicKey;
  vault: PublicKey;
  /** Market liquidity escrow for PT (`token_pt_escrow`). */
  tokenPtEscrow: PublicKey;
  /** Market pass-through SY escrow (`token_sy_escrow`). */
  tokenSyEscrow: PublicKey;
  /** SY account holding treasury fees from PT trading (`token_fee_treasury_sy`). */
  tokenFeeTreasurySy: PublicKey;
  addressLookupTable: PublicKey;
  syProgram: PublicKey;
  statusFlags: number;
  /** SY-program CPI account lists, referenced by ALT index. */
  cpiAccounts: ExponentMarketTwoCpiAccounts;
}

/**
 * Accounts required by `trade_pt`. The first 12 are the fixed `#[derive(Accounts)]`
 * accounts; `remainingAccounts` are the SY-program CPI accounts (already resolved from
 * the market ALT by {@link ResolveExponentTradePtContextParams}).
 */
export interface ExponentTradePtAccounts {
  /** Trader / signer (the marginfi account authority). */
  trader: PublicKey;
  /** The `MarketTwo` address. */
  market: PublicKey;
  /** Trader's SY token account (source of the SY spent buying PT). */
  tokenSyTrader: PublicKey;
  /** Trader's PT token account (destination of the bought PT). */
  tokenPtTrader: PublicKey;
  /** `MarketTwo.token_sy_escrow`. */
  tokenSyEscrow: PublicKey;
  /** `MarketTwo.token_pt_escrow`. */
  tokenPtEscrow: PublicKey;
  /** `MarketTwo.address_lookup_table`. */
  addressLookupTable: PublicKey;
  /** `MarketTwo.sy_program`. */
  syProgram: PublicKey;
  /** `MarketTwo.token_fee_treasury_sy`. */
  tokenFeeTreasurySy: PublicKey;
  /** SPL token program for the PT/SY mints (defaults to the classic Token program). */
  tokenProgram?: PublicKey;
  /**
   * SY-program CPI accounts (`getSyState` ++ `depositSy` ++ `withdrawSy`), pubkeys
   * already resolved from the market ALT. Appended after the 12 fixed accounts.
   */
  remainingAccounts: AccountMeta[];
}

export interface ResolveExponentTradePtContextParams {
  connection: Connection;
  /** Trader / signer (the marginfi account authority). */
  owner: PublicKey;
  /** The successor maturity's `MarketTwo` address (where the new PT trades). */
  market: PublicKey;
  /** Token program for the PT mint (Exponent uses the classic Token program). */
  ptTokenProgram?: PublicKey;
  /** Token program for the SY mint. Defaults to classic Token. */
  syTokenProgram?: PublicKey;
}

/**
 * Resolved inputs for a native `trade_pt` (SY → PT) on an Exponent `MarketTwo`: the
 * fully-resolved `trade_pt` accounts (including the ALT-derived SY-CPI remaining
 * accounts), the market ALT to add to the transaction's lookup tables, and the SY/PT
 * token info. Feed `tradePtAccounts` + `addressLookupTable` into `makeRollPtTx`.
 */
export interface ExponentTradePtContext {
  marketAddress: PublicKey;
  market: ExponentMarketTwo;
  tradePtAccounts: ExponentTradePtAccounts;
  /** The market's address lookup table account — must be carried by the transaction. */
  addressLookupTable: AddressLookupTableAccount;
  sy: { mint: PublicKey; decimals: number; tokenProgram: PublicKey };
  pt: { mint: PublicKey; decimals: number; tokenProgram: PublicKey };
}
