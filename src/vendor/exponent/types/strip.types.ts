import {
  AccountMeta,
  AddressLookupTableAccount,
  Connection,
  PublicKey,
} from "@solana/web3.js";

import { ExponentVault } from "./vault.types";

/**
 * Accounts required by `strip` (SY → PT + YT). The first 15 are the fixed
 * `#[derive(Accounts)]` accounts; `remainingAccounts` are the flavor's `deposit_sy` CPI
 * accounts (resolved from the vault ALT by {@link ResolveExponentStripContextParams}).
 */
export interface ExponentStripAccounts {
  /** Depositor / signer (the marginfi account authority). */
  depositor: PublicKey;
  /** Vault signer authority (`Vault.authority`). */
  authority: PublicKey;
  /** The vault address. */
  vault: PublicKey;
  /** Owner's SY token account (source of the SY being stripped). */
  sySrc: PublicKey;
  /** `Vault.escrow_sy`. */
  escrowSy: PublicKey;
  /** Owner's YT token account (destination of the minted YT). */
  ytDst: PublicKey;
  /** Owner's PT token account (destination of the minted PT). */
  ptDst: PublicKey;
  /** `Vault.mint_yt`. */
  mintYt: PublicKey;
  /** `Vault.mint_pt`. */
  mintPt: PublicKey;
  /** `Vault.sy_program`. */
  syProgram: PublicKey;
  /** `Vault.address_lookup_table`. */
  addressLookupTable: PublicKey;
  /** `Vault.yield_position`. */
  yieldPosition: PublicKey;
  /** SPL token program for PT/YT/SY mints (defaults to the classic Token program). */
  tokenProgram?: PublicKey;
  /** SY-program CPI accounts (`deposit_sy`), pubkeys already resolved from the vault ALT. */
  remainingAccounts?: AccountMeta[];
}

export interface ResolveExponentStripContextParams {
  connection: Connection;
  /** Depositor / signer (the marginfi account authority). */
  owner: PublicKey;
  /** The (active, successor) vault to strip into, or… */
  vault?: PublicKey;
  /** …its `MarketTwo` address (its `vault` will be read). One of `vault`/`market` is required. */
  market?: PublicKey;
  /** Token program for the PT/YT mints (Exponent uses the classic Token program). */
  ptYtTokenProgram?: PublicKey;
  /** Token program for the SY mint. Defaults to classic Token. */
  syTokenProgram?: PublicKey;
}

/**
 * Resolved inputs for `strip` (SY → PT + YT) on an Exponent vault: the strip accounts
 * (incl. the ALT-derived `deposit_sy` remaining accounts), the vault ALT to add to the
 * transaction's lookup tables, the SY/PT/YT token info, and a helper to size the minted PT.
 */
export interface ExponentStripContext {
  vaultAddress: PublicKey;
  vault: ExponentVault;
  stripAccounts: ExponentStripAccounts;
  /** The vault's address lookup table — must be carried by the transaction. */
  addressLookupTable: AddressLookupTableAccount;
  sy: { mint: PublicKey; decimals: number; tokenProgram: PublicKey };
  pt: { mint: PublicKey; decimals: number; tokenProgram: PublicKey };
  yt: { mint: PublicKey; tokenProgram: PublicKey };
  /** Last-seen SY exchange rate (underlying per SY), from `Vault.last_seen_sy_exchange_rate`. */
  syExchangeRate: number;
  /**
   * Native PT `strip` mints for a given native SY in: `floor(syIn × last_seen_sy_exchange_rate)`.
   * The last-seen rate can lag the live rate slightly, so apply a small safety buffer (the
   * minted PT is also the YT amount). Use the result as `MakeRollPtTxParams.ptOutNative`.
   */
  computeStrippedPtNative(syInNative: bigint): bigint;
}
