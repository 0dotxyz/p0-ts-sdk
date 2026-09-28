import type { Address } from "@solana/kit";

/** Curated Gamma `LpVault`: the fields the SDK reads. A decoded `LpVault` satisfies it structurally. */
export interface GammaLpVault {
  /** Token account holding the vault's deposited assets. */
  assetsAccount: Address;
  sharesMint: Address;
  assetsMint: Address;
  /** Share token account receiving fee shares; the default address when fees are off. */
  feeRecipient: Address;
}

/**
 * Curated Gamma `WithdrawReceipt`: a user's queued withdrawal (pending until a keeper fulfills it)
 * and what is claimable once it is.
 */
export interface GammaWithdrawReceipt {
  user: Address;
  lpVault: Address;
  /** Share mint base units awaiting a keeper. */
  pendingShares: bigint;
  /** Share mint base units fulfilled and ready to claim. */
  claimableShares: bigint;
  /** Asset mint base units ready to claim. */
  claimableAssets: bigint;
}
