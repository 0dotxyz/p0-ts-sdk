import {
  AccountMeta,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";
import BN from "bn.js";

import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID } from "~/vendor/spl";

import { GAMMA_VAULT_PROGRAM_ID } from "./constants";

// Anchor instruction discriminators (from the Gamma vault IDL).
const DEPOSIT_DISCRIMINATOR = Buffer.from([242, 35, 198, 137, 82, 225, 242, 182]);
const WITHDRAW_DISCRIMINATOR = Buffer.from([183, 18, 70, 156, 148, 109, 161, 34]);
const COMPLETE_WITHDRAWAL_DISCRIMINATOR = Buffer.from([107, 98, 134, 131, 74, 120, 174, 121]);

/** Encode a u64 argument as an 8-byte little-endian buffer. */
const encodeU64 = (amount: BN): Buffer => amount.toArrayLike(Buffer, "le", 8);

const meta = (pubkey: PublicKey, isSigner: boolean, isWritable: boolean): AccountMeta => ({
  pubkey,
  isSigner,
  isWritable,
});

// ============================================================================
// deposit
// ============================================================================

export interface GammaDepositAccounts {
  user: PublicKey;
  lpVault: PublicKey;
  withdrawalPolicy: PublicKey;
  depositPolicy: PublicKey;
  assetsAccount: PublicKey;
  userAssetAta: PublicKey;
  userShareAta: PublicKey;
  depositReceipt: PublicKey;
  assetsMint: PublicKey;
  sharesMint: PublicKey;
  tokenProgram?: PublicKey;
  associatedTokenProgram?: PublicKey;
}

/**
 * Deposit `amount` (raw base units of the vault's asset mint) into a Gamma LP
 * vault. Instant deposit: user receives vault shares in the same transaction.
 * The program creates `user_share_ata` and `deposit_receipt` if needed.
 */
export function makeGammaDepositIx(
  accounts: GammaDepositAccounts,
  amount: BN
): TransactionInstruction {
  const tokenProgram = accounts.tokenProgram ?? TOKEN_PROGRAM_ID;
  const associatedTokenProgram = accounts.associatedTokenProgram ?? ASSOCIATED_TOKEN_PROGRAM_ID;

  const keys: AccountMeta[] = [
    meta(accounts.user, true, true),
    meta(accounts.lpVault, false, true),
    meta(accounts.withdrawalPolicy, false, true),
    meta(accounts.depositPolicy, false, false),
    meta(accounts.assetsAccount, false, true),
    meta(accounts.userAssetAta, false, true),
    meta(accounts.userShareAta, false, true),
    meta(accounts.depositReceipt, false, true),
    meta(accounts.assetsMint, false, false),
    meta(accounts.sharesMint, false, true),
    meta(SystemProgram.programId, false, false),
    meta(tokenProgram, false, false),
    meta(associatedTokenProgram, false, false),
  ];

  return new TransactionInstruction({
    keys,
    programId: GAMMA_VAULT_PROGRAM_ID,
    data: Buffer.concat([DEPOSIT_DISCRIMINATOR, encodeU64(amount)]),
  });
}

// ============================================================================
// withdraw (initiate — queues an escrow withdrawal)
// ============================================================================

export interface GammaWithdrawAccounts {
  user: PublicKey;
  lpVault: PublicKey;
  withdrawalPolicy: PublicKey;
  assetsAccount: PublicKey;
  userShareAta: PublicKey;
  assetsMint: PublicKey;
  sharesMint: PublicKey;
  feeRecipientAccount: PublicKey;
  withdrawEscrow: PublicKey;
  escrowAssetsAccount: PublicKey;
  escrowSharesAccount: PublicKey;
  withdrawReceipt: PublicKey;
  tokenProgram?: PublicKey;
  associatedTokenProgram?: PublicKey;
}

/**
 * Initiate a withdrawal of `sharesAmount` (raw base units of the vault's share
 * mint) from a Gamma LP vault. Shares are escrowed and a WithdrawReceipt is
 * created/updated; assets become claimable via {@link makeGammaCompleteWithdrawalIx}
 * once the withdrawal is fulfilled by a keeper.
 */
export function makeGammaWithdrawIx(
  accounts: GammaWithdrawAccounts,
  sharesAmount: BN
): TransactionInstruction {
  const tokenProgram = accounts.tokenProgram ?? TOKEN_PROGRAM_ID;
  const associatedTokenProgram = accounts.associatedTokenProgram ?? ASSOCIATED_TOKEN_PROGRAM_ID;

  const keys: AccountMeta[] = [
    meta(accounts.user, true, true),
    meta(accounts.lpVault, false, true),
    meta(accounts.withdrawalPolicy, false, true),
    meta(accounts.assetsAccount, false, true),
    meta(accounts.userShareAta, false, true),
    meta(accounts.assetsMint, false, false),
    meta(accounts.sharesMint, false, true),
    meta(accounts.feeRecipientAccount, false, true),
    meta(accounts.withdrawEscrow, false, true),
    meta(accounts.escrowAssetsAccount, false, true),
    meta(accounts.escrowSharesAccount, false, true),
    meta(accounts.withdrawReceipt, false, true),
    meta(SystemProgram.programId, false, false),
    meta(tokenProgram, false, false),
    meta(associatedTokenProgram, false, false),
  ];

  return new TransactionInstruction({
    keys,
    programId: GAMMA_VAULT_PROGRAM_ID,
    data: Buffer.concat([WITHDRAW_DISCRIMINATOR, encodeU64(sharesAmount)]),
  });
}

// ============================================================================
// complete_withdrawal (claim fulfilled assets)
// ============================================================================

export interface GammaCompleteWithdrawalAccounts {
  user: PublicKey;
  lpVault: PublicKey;
  assetsMint: PublicKey;
  sharesMint: PublicKey;
  userAssetAta: PublicKey;
  withdrawEscrow: PublicKey;
  escrowAssetsAccount: PublicKey;
  escrowSharesAccount: PublicKey;
  withdrawReceipt: PublicKey;
  tokenProgram?: PublicKey;
  associatedTokenProgram?: PublicKey;
}

/**
 * Claim the assets from a fulfilled Gamma withdrawal. Transfers the claimable
 * assets from the escrow to the user's asset ATA (created if needed).
 */
export function makeGammaCompleteWithdrawalIx(
  accounts: GammaCompleteWithdrawalAccounts
): TransactionInstruction {
  const tokenProgram = accounts.tokenProgram ?? TOKEN_PROGRAM_ID;
  const associatedTokenProgram = accounts.associatedTokenProgram ?? ASSOCIATED_TOKEN_PROGRAM_ID;

  const keys: AccountMeta[] = [
    meta(accounts.user, true, true),
    meta(accounts.lpVault, false, false),
    meta(accounts.assetsMint, false, false),
    meta(accounts.sharesMint, false, true),
    meta(accounts.userAssetAta, false, true),
    meta(accounts.withdrawEscrow, false, true),
    meta(accounts.escrowAssetsAccount, false, true),
    meta(accounts.escrowSharesAccount, false, true),
    meta(accounts.withdrawReceipt, false, true),
    meta(SystemProgram.programId, false, false),
    meta(tokenProgram, false, false),
    meta(associatedTokenProgram, false, false),
  ];

  return new TransactionInstruction({
    keys,
    programId: GAMMA_VAULT_PROGRAM_ID,
    data: COMPLETE_WITHDRAWAL_DISCRIMINATOR,
  });
}
