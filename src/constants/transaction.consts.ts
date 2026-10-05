export const MAX_TX_SIZE: number = 1232;
export const MAX_ACCOUNT_LOCKS = 64;
export const BUNDLE_TX_SIZE: number = 81;
export const PRIORITY_TX_SIZE: number = 44;

/**
 * The resource limits every SDK-built v1 message carries in its config. A v1 message has no
 * implicit limits (unset means zero compute units and zero loaded bytes), so these are the maximum
 * compute budget and the loaded-accounts size a v0 message gets by default. The zero priority fee
 * reserves its config bytes, so setting the real fee cannot outgrow a checked size.
 */
export const V1_TRANSACTION_CONFIG = {
  computeUnitLimit: 1_400_000,
  loadedAccountsDataSizeLimit: 64 * 1024 * 1024,
  priorityFeeLamports: 0n,
};
