import {
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import BigNumber from "bignumber.js";
import BN from "bn.js";

import {
  deriveGammaAta,
  deriveGammaWithdrawEscrow,
  deriveGammaWithdrawReceipt,
  deriveGammaWithdrawalPolicy,
  makeGammaCompleteWithdrawalIx,
  makeGammaWithdrawIx,
} from "~/vendor/gamma";
import {
  addTransactionMetadata,
  ExtendedV0Transaction,
  InstructionsWrapper,
  TransactionType,
} from "~/services/transaction";

import { fetchGammaLpVault, resolveVaultTokenProgram } from "../utils";
import type {
  MakeVaultCompleteWithdrawalIxParams,
  MakeVaultCompleteWithdrawalTxParams,
  MakeVaultWithdrawIxParams,
  MakeVaultWithdrawTxParams,
} from "../types";

/**
 * Build the instruction to initiate a withdrawal from a Gamma LP vault. Shares
 * are escrowed and a WithdrawReceipt is created/updated; the assets become
 * claimable via {@link makeVaultCompleteWithdrawalIx} once a keeper fulfills
 * the withdrawal.
 *
 * `sharesAmount` is interpreted as raw base units of the vault's share mint.
 */
export async function makeVaultWithdrawIx(
  params: MakeVaultWithdrawIxParams
): Promise<InstructionsWrapper> {
  const { sharesAmount, user, lpVault, connection } = params;

  const vault = await fetchGammaLpVault(connection, lpVault);
  const tokenProgram =
    params.tokenProgram ?? (await resolveVaultTokenProgram(connection, vault.assetsMint));

  const [withdrawalPolicy] = deriveGammaWithdrawalPolicy(lpVault);
  const [withdrawEscrow] = deriveGammaWithdrawEscrow(user, lpVault);
  const [withdrawReceipt] = deriveGammaWithdrawReceipt(user, lpVault);

  const userShareAta = deriveGammaAta(vault.sharesMint, user, tokenProgram);
  const feeRecipientAccount = deriveGammaAta(vault.assetsMint, vault.feeRecipient, tokenProgram);
  const escrowAssetsAccount = deriveGammaAta(vault.assetsMint, withdrawEscrow, tokenProgram);
  const escrowSharesAccount = deriveGammaAta(vault.sharesMint, withdrawEscrow, tokenProgram);

  const sharesNative = new BN(new BigNumber(sharesAmount).toFixed(0));

  const ix = makeGammaWithdrawIx(
    {
      user,
      lpVault,
      withdrawalPolicy,
      assetsAccount: vault.assetsAccount,
      userShareAta,
      assetsMint: vault.assetsMint,
      sharesMint: vault.sharesMint,
      feeRecipientAccount,
      withdrawEscrow,
      escrowAssetsAccount,
      escrowSharesAccount,
      withdrawReceipt,
      tokenProgram,
    },
    sharesNative
  );

  const instructions: TransactionInstruction[] = [ix];

  return { instructions, keys: [] };
}

/** Build a versioned transaction to initiate a withdrawal from a Gamma LP vault. */
export async function makeVaultWithdrawTx(
  params: MakeVaultWithdrawTxParams
): Promise<ExtendedV0Transaction> {
  const { connection, user, luts, blockhash: providedBlockhash } = params;

  const { instructions, keys } = await makeVaultWithdrawIx(params);

  const blockhash =
    providedBlockhash ?? (await connection.getLatestBlockhash("confirmed")).blockhash;

  const message = new TransactionMessage({
    payerKey: user,
    recentBlockhash: blockhash,
    instructions,
  }).compileToV0Message(luts);

  const tx = new VersionedTransaction(message);

  return addTransactionMetadata(tx, {
    signers: keys,
    addressLookupTables: luts,
    type: TransactionType.VAULT_WITHDRAW,
  });
}

/**
 * Build the instruction to claim assets from a fulfilled Gamma withdrawal.
 * Transfers the claimable assets from the escrow to the user's asset ATA
 * (created by the program if needed).
 */
export async function makeVaultCompleteWithdrawalIx(
  params: MakeVaultCompleteWithdrawalIxParams
): Promise<InstructionsWrapper> {
  const { user, lpVault, connection } = params;

  const vault = await fetchGammaLpVault(connection, lpVault);
  const tokenProgram =
    params.tokenProgram ?? (await resolveVaultTokenProgram(connection, vault.assetsMint));

  const [withdrawEscrow] = deriveGammaWithdrawEscrow(user, lpVault);
  const [withdrawReceipt] = deriveGammaWithdrawReceipt(user, lpVault);

  const userAssetAta = deriveGammaAta(vault.assetsMint, user, tokenProgram);
  const escrowAssetsAccount = deriveGammaAta(vault.assetsMint, withdrawEscrow, tokenProgram);
  const escrowSharesAccount = deriveGammaAta(vault.sharesMint, withdrawEscrow, tokenProgram);

  const ix = makeGammaCompleteWithdrawalIx({
    user,
    lpVault,
    assetsMint: vault.assetsMint,
    sharesMint: vault.sharesMint,
    userAssetAta,
    withdrawEscrow,
    escrowAssetsAccount,
    escrowSharesAccount,
    withdrawReceipt,
    tokenProgram,
  });

  return { instructions: [ix], keys: [] };
}

/** Build a versioned transaction to claim a fulfilled Gamma withdrawal. */
export async function makeVaultCompleteWithdrawalTx(
  params: MakeVaultCompleteWithdrawalTxParams
): Promise<ExtendedV0Transaction> {
  const { connection, user, luts, blockhash: providedBlockhash } = params;

  const { instructions, keys } = await makeVaultCompleteWithdrawalIx(params);

  const blockhash =
    providedBlockhash ?? (await connection.getLatestBlockhash("confirmed")).blockhash;

  const message = new TransactionMessage({
    payerKey: user,
    recentBlockhash: blockhash,
    instructions,
  }).compileToV0Message(luts);

  const tx = new VersionedTransaction(message);

  return addTransactionMetadata(tx, {
    signers: keys,
    addressLookupTables: luts,
    type: TransactionType.VAULT_COMPLETE_WITHDRAWAL,
  });
}
