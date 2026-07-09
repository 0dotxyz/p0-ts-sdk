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
