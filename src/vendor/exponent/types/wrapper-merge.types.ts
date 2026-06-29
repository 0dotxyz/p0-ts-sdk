import {
  AccountMeta,
  AddressLookupTableAccount,
  Connection,
  PublicKey,
  TransactionInstruction,
} from "@solana/web3.js";

import { ExponentVault } from "./vault.types";

/**
 * Accounts required by `wrapper_merge` — the core instruction that merges PT **and**
 * redeems the resulting SY into the underlying **base** token in one go (so the buy leg can
 * swap a normal token, not the un-swappable SY). The 16 fixed accounts mirror the IDL's
 * `WrapperMerge` struct (same vault-side fields as `merge`, minus the SY destination order);
 * `remainingAccounts` is the assembled `[...redeem, ...cpi]` list and `redeemSyAccountsUntil`
 * marks the boundary between them.
 */
export interface ExponentWrapperMergeAccounts {
  /** Position owner / signer (the marginfi account authority). */
  owner: PublicKey;
  /** Owner's SY token account (intermediate; the redeem consumes it). */
  syAta: PublicKey;
  /** The maturity vault address. */
  vault: PublicKey;
  /** `Vault.escrow_sy`. */
  escrowSy: PublicKey;
  /** Owner's YT token account (source; empty/0 after maturity). */
  ytAta: PublicKey;
  /** Owner's PT token account (source; holds the withdrawn PT). */
  ptAta: PublicKey;
  /** `Vault.mint_yt`. */
  mintYt: PublicKey;
  /** `Vault.mint_pt`. */
  mintPt: PublicKey;
  /** `Vault.authority`. */
  authority: PublicKey;
  /** `Vault.address_lookup_table`. */
  addressLookupTable: PublicKey;
  /** `Vault.yield_position` (the vault robot yield position). */
  yieldPosition: PublicKey;
  /** `Vault.sy_program`. */
  syProgram: PublicKey;
  /** SPL token program for the PT/YT/SY mints (defaults to classic Token). */
  tokenProgram?: PublicKey;
  /**
   * Assembled SY-program remaining accounts: the flavor's `redeem_sy` accounts first
   * (count = `redeemSyAccountsUntil`), then the vault's deduped `withdraw_sy ++ get_sy_state`
   * CPI accounts. The redeem's first account is the owner and keeps its signer flag.
   */
  remainingAccounts: AccountMeta[];
  /** Number of leading `remainingAccounts` that are the flavor redeem accounts. */
  redeemSyAccountsUntil: number;
}

export interface ResolveExponentWrapperMergeContextParams {
  connection: Connection;
  /** Position owner / signer (the marginfi account authority). */
  owner: PublicKey;
  /** The maturity vault, or… */
  vault?: PublicKey;
  /** …the `MarketTwo` address (its `vault` is read). One of `vault`/`market` is required. */
  market?: PublicKey;
  /**
   * The flavor's underlying **base** token (e.g. bulkSOL). Required — it isn't on the
   * vault; the caller supplies it (config). The redeem unwraps SY into this token.
   */
  baseMint: PublicKey;
  /** Token program for the base mint (defaults to classic Token). */
  baseTokenProgram?: PublicKey;
  /** Token program for the PT/YT mints (Exponent uses classic Token). */
  ptYtTokenProgram?: PublicKey;
  /** Token program for the SY mint (may be token-2022). Defaults to classic Token. */
  syTokenProgram?: PublicKey;
}

/**
 * Resolved inputs for the roll's redeem leg: the `wrapper_merge` accounts, the SPL
 * stake-pool refresh that must run before it (so the SY↔base rate is current), the base
 * token the swap leg consumes, and a helper to size the redeemed base from the vault rates.
 */
export interface ExponentWrapperMergeContext {
  vaultAddress: PublicKey;
  vault: ExponentVault;
  wrapperMergeAccounts: ExponentWrapperMergeAccounts;
  /**
   * Instruction(s) the flavor requires *before* `wrapper_merge` (for an SPL-stake-pool LST
   * like bulkSOL, the stake pool's `UpdateStakePoolBalance` refresh). Empty for flavors that
   * need none.
   */
  preInstructions: TransactionInstruction[];
  /** The vault's address lookup table — add it to the transaction's lookup tables. */
  addressLookupTable: AddressLookupTableAccount;
  /** The redeemed underlying base token (swap-leg input). */
  baseToken: { mint: PublicKey; decimals: number; tokenProgram: PublicKey };
  /** ATAs the bundle touches and must create idempotently (sy, pt, yt, base). */
  setupMints: { mint: PublicKey; tokenProgram: PublicKey }[];
  /**
   * Native base the wrapper yields for a native PT amount: `merge` gives
   * `sy = floor(pt × sy_for_pt / pt_supply)`, then the redeem gives
   * `base = floor(sy × sy_exchange_rate)`. Feed into the swap-engine input sizing.
   */
  computeRedeemedBaseNative(ptAmountNative: bigint): bigint;
}
