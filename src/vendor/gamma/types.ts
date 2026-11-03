import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";

/**
 * Decoded Gamma `LpVault` account (raw on-chain representation).
 * Pubkeys as {@link PublicKey}, u64/i64 numeric fields as {@link BN}.
 */
export interface GammaLpVaultRaw {
  pubkey: PublicKey;
  assetsAccount: PublicKey;
  pendingSharesAccount: PublicKey;
  sharesMint: PublicKey;
  assetsMint: PublicKey;
  fundAuthority: PublicKey;
  nav: BN;
  totalShares: BN;
  navUpdatedAt: BN;
  navMaxStaleness: BN;
  bump: number;
  vaultName: string;
  pendingWithdrawalValue: BN;
  feeRecipient: PublicKey;
  performanceFeeBps: number;
  assessmentIntervalSecs: BN;
  lastAssessmentTimestamp: BN;
  pricePerShareAtLastAssessment: BN;
  keeperAuthority: PublicKey;
}

/**
 * Decoded Gamma `WithdrawReceipt` account — tracks a user's queued withdrawal
 * against a vault (pending → claimable).
 */
export interface GammaWithdrawReceiptRaw {
  pubkey: PublicKey;
  user: PublicKey;
  lpVault: PublicKey;
  pendingShares: BN;
  claimableShares: BN;
  claimableAssets: BN;
  oldestPendingAt: BN;
  bump: number;
}

/**
 * Decoded Gamma `DepositPolicy` account — the vault's deposit cap and pause switch.
 * One per vault, PDA `["deposit_policy", lpVault]`.
 */
export interface GammaDepositPolicyRaw {
  pubkey: PublicKey;
  lpVault: PublicKey;
  /** Max vault NAV in asset-mint base units that deposits may fill up to. */
  capacityAssets: BN;
  /** When true the program rejects every deposit. */
  depositsPaused: boolean;
  bump: number;
}

/**
 * Decoded Gamma `WithdrawalPolicy` account — the vault's withdrawal fee and rolling
 * hourly/daily withdrawal caps. One per vault, PDA `["withdrawal_policy", lpVault]`.
 */
export interface GammaWithdrawalPolicyRaw {
  pubkey: PublicKey;
  lpVault: PublicKey;
  /** Fee on withdrawn assets in basis points (10 = 0.1%). */
  withdrawalFeeBps: number;
  /** Max share of NAV withdrawable per hourly window, in basis points. */
  hourlyWithdrawalCapBps: number;
  /** Max share of NAV withdrawable per daily window, in basis points. */
  dailyWithdrawalCapBps: number;
  /** Asset-mint base units withdrawn in the current hourly window. */
  hourlyWithdrawnAssets: BN;
  /** Asset-mint base units withdrawn in the current daily window. */
  dailyWithdrawnAssets: BN;
  /** Unix timestamp (seconds) the current hourly window started. */
  hourlyWindowStart: BN;
  /** Unix timestamp (seconds) the current daily window started. */
  dailyWindowStart: BN;
  bump: number;
}
