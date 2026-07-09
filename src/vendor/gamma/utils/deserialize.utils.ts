import { PublicKey } from "@solana/web3.js";
import { BorshAccountsCoder } from "@coral-xyz/anchor";
import BN from "bn.js";

import { GAMMA_VAULT_IDL } from "../idl";
import { GammaLpVaultRaw, GammaWithdrawReceiptRaw } from "../types";

const GAMMA_ACCOUNTS_CODER = new BorshAccountsCoder(GAMMA_VAULT_IDL);

const lpVaultDiscriminator = Buffer.from([189, 45, 167, 23, 91, 118, 105, 190]);
const withdrawReceiptDiscriminator = Buffer.from([132, 238, 44, 182, 207, 9, 124, 140]);

const toBN = (v: unknown): BN => (BN.isBN(v) ? (v as BN) : new BN((v ?? 0).toString()));

/** Decode a Gamma `LpVault` account from raw buffer data. */
export function decodeGammaLpVaultData(data: Buffer, pubkey: PublicKey): GammaLpVaultRaw {
  if (!data.subarray(0, 8).equals(lpVaultDiscriminator)) {
    throw new Error("invalid Gamma LpVault account discriminator");
  }

  const d = GAMMA_ACCOUNTS_CODER.decode("LpVault", data) as any;

  return {
    pubkey,
    assetsAccount: d.assets_account ?? d.assetsAccount,
    pendingSharesAccount: d.pending_shares_account ?? d.pendingSharesAccount,
    sharesMint: d.shares_mint ?? d.sharesMint,
    assetsMint: d.assets_mint ?? d.assetsMint,
    fundAuthority: d.fund_authority ?? d.fundAuthority,
    nav: toBN(d.nav),
    totalShares: toBN(d.total_shares ?? d.totalShares),
    navUpdatedAt: toBN(d.nav_updated_at ?? d.navUpdatedAt),
    navMaxStaleness: toBN(d.nav_max_staleness ?? d.navMaxStaleness),
    bump: d.bump,
    vaultName: d.vault_name ?? d.vaultName,
    pendingWithdrawalValue: toBN(d.pending_withdrawal_value ?? d.pendingWithdrawalValue),
    feeRecipient: d.fee_recipient ?? d.feeRecipient,
    performanceFeeBps: d.performance_fee_bps ?? d.performanceFeeBps,
    assessmentIntervalSecs: toBN(d.assessment_interval_secs ?? d.assessmentIntervalSecs),
    lastAssessmentTimestamp: toBN(d.last_assessment_timestamp ?? d.lastAssessmentTimestamp),
    pricePerShareAtLastAssessment: toBN(
      d.price_per_share_at_last_assessment ?? d.pricePerShareAtLastAssessment
    ),
    keeperAuthority: d.keeper_authority ?? d.keeperAuthority,
  };
}

/** Decode a Gamma `WithdrawReceipt` account from raw buffer data. */
export function decodeGammaWithdrawReceiptData(
  data: Buffer,
  pubkey: PublicKey
): GammaWithdrawReceiptRaw {
  if (!data.subarray(0, 8).equals(withdrawReceiptDiscriminator)) {
    throw new Error("invalid Gamma WithdrawReceipt account discriminator");
  }

  const d = GAMMA_ACCOUNTS_CODER.decode("WithdrawReceipt", data) as any;

  return {
    pubkey,
    user: d.user,
    lpVault: d.lp_vault ?? d.lpVault,
    pendingShares: toBN(d.pending_shares ?? d.pendingShares),
    claimableShares: toBN(d.claimable_shares ?? d.claimableShares),
    claimableAssets: toBN(d.claimable_assets ?? d.claimableAssets),
    oldestPendingAt: toBN(d.oldest_pending_at ?? d.oldestPendingAt),
    bump: d.bump,
  };
}
