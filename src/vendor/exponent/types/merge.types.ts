import { Connection, PublicKey } from "@solana/web3.js";

import { ExponentVault } from "./vault.types";

/**
 * Accounts required by `merge`. Most are read off the maturity's `Vault` account
 * (`mintYt`, `mintPt`, `escrowSy`, `syProgram`, `addressLookupTable`, `yieldPosition`,
 * `authority`); the `*Ata` accounts are the owner's token accounts.
 *
 * After maturity, `merge` burns PT only (the YT burn is skipped because the vault is
 * inactive) — but the YT accounts are still required by the instruction, so `ytSrcAta`
 * must be a valid (possibly empty, freshly-created) YT token account.
 */
export interface ExponentMergeAccounts {
  /** Position owner / signer (the marginfi account authority). */
  owner: PublicKey;
  /** Vault signer authority (`Vault.authority`). */
  authority: PublicKey;
  /** The maturity vault address. */
  vault: PublicKey;
  /** Owner's SY token account (destination of the redeemed SY). */
  sySrcDstAta: PublicKey;
  /** `Vault.escrow_sy`. */
  escrowSy: PublicKey;
  /** Owner's YT token account (source; empty/0 after maturity). */
  ytSrcAta: PublicKey;
  /** Owner's PT token account (source; holds the withdrawn PT). */
  ptSrcAta: PublicKey;
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
  /** SPL token program for PT/YT/SY mints (defaults to the classic token program). */
  tokenProgram?: PublicKey;
}

export interface ResolveExponentMergeContextParams {
  connection: Connection;
  /** Position owner / signer (the marginfi account authority). */
  owner: PublicKey;
  /** The maturity vault, or… */
  vault?: PublicKey;
  /** …the `MarketTwo` address (its `vault` will be read). One of `vault`/`market` is required. */
  market?: PublicKey;
  /** Token program for the PT/YT mints (Exponent's `merge` uses the classic Token program). */
  ptYtTokenProgram?: PublicKey;
  /** Token program for the SY mint (may be token-2022). Defaults to classic Token. */
  syTokenProgram?: PublicKey;
}

/**
 * Resolved inputs for `makeRollPtTx`, derived from the maturity `Vault`: the `merge`
 * accounts, the SY (underlying) token the swap leg consumes, and a helper to size the
 * redeemed SY amount from `Vault.final_sy_exchange_rate`.
 */
export interface ExponentMergeContext {
  vaultAddress: PublicKey;
  vault: ExponentVault;
  mergeAccounts: ExponentMergeAccounts;
  underlying: { mint: PublicKey; decimals: number; tokenProgram: PublicKey };
  /**
   * Native SY that `merge` yields for a given native PT amount, at the matured rate:
   * `floor(ptAmountNative × final_sy_exchange_rate)`. Assumes PT and SY share decimals
   * (true for Exponent vaults). Feed its result into `MakeRollPtTxParams.redeemedAmountNative`.
   */
  computeRedeemedAmountNative(ptAmountNative: bigint): bigint;
}
