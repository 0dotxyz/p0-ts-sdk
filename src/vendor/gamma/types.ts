import type { Address } from "@solana/kit";

/**
 * Curated Gamma `LpVault`: the fields the SDK and its consumers read (accounts for building, NAV and
 * share supply for the share price, staleness for whether deposits/withdrawals can run). A decoded
 * `LpVault` satisfies it structurally.
 */
export interface GammaLpVault {
  /** Token account holding the vault's deposited assets. */
  assetsAccount: Address;
  /** Share token account holding shares during queued (illiquid) withdrawals. */
  pendingSharesAccount: Address;
  sharesMint: Address;
  assetsMint: Address;
  /** Share token account receiving fee shares; the default address when fees are off. */
  feeRecipient: Address;
  /** Current net asset value: total vault value in asset mint base units. */
  nav: bigint;
  /**
   * Total shares outstanding, in share mint base units. May briefly differ from the share mint's
   * supply between a withdrawal's fulfillment and its claim. Share price = `nav / totalShares`.
   */
  totalShares: bigint;
  /** Unix timestamp (seconds) of the last NAV update. */
  navUpdatedAt: bigint;
  /** Max NAV age in seconds for user operations: deposits and withdrawals fail past it. */
  navMaxStaleness: bigint;
  /**
   * Approximate value of withdrawals queued for liquidity, in asset mint base units (recorded at
   * withdrawal time; operator visibility only, not for exact math).
   */
  pendingWithdrawalValue: bigint;
  /** Performance fee in basis points (2000 = 20%); 0 = disabled. */
  performanceFeeBps: number;
  /** On-chain vault name, e.g. `p0STBL1`. */
  vaultName: string;
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

/**
 * Curated Gamma `DepositPolicy`: the vault's deposit cap and pause switch. One per vault, PDA
 * `["deposit_policy", lpVault]`.
 */
export interface GammaDepositPolicy {
  lpVault: Address;
  /** Max post-deposit NAV in asset mint base units. */
  capacityAssets: bigint;
  /** When true the program rejects every deposit (withdrawals don't consult it). */
  depositsPaused: boolean;
}

/**
 * Curated Gamma `WithdrawalPolicy`: the vault's withdrawal fee and rolling hourly/daily withdrawal
 * caps. One per vault, PDA `["withdrawal_policy", lpVault]`.
 */
export interface GammaWithdrawalPolicy {
  lpVault: Address;
  /** Fee on withdrawn assets, retained in the vault, in basis points (10 = 0.1%). */
  withdrawalFeeBps: number;
  /** Max net withdrawal per hourly window as basis points of current NAV; 0 = disabled. */
  hourlyWithdrawalCapBps: number;
  /** Max net withdrawal per daily window as basis points of current NAV; 0 = disabled. */
  dailyWithdrawalCapBps: number;
  /** Net withdrawn assets counted in the current hourly window, in asset mint base units. */
  hourlyWithdrawnAssets: bigint;
  /** Net withdrawn assets counted in the current daily window, in asset mint base units. */
  dailyWithdrawnAssets: bigint;
  /** Unix timestamp (seconds) the current hourly window started. */
  hourlyWindowStart: bigint;
  /** Unix timestamp (seconds) the current daily window started. */
  dailyWindowStart: bigint;
}
