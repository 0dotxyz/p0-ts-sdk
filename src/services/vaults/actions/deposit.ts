import {
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import BigNumber from "bignumber.js";
import BN from "bn.js";

import {
  deriveGammaAta,
  deriveGammaDepositReceipt,
  deriveGammaWithdrawalPolicy,
  makeGammaDepositIx,
} from "~/vendor/gamma";
import { createAssociatedTokenAccountIdempotentInstruction } from "~/vendor/spl";
import {
  addTransactionMetadata,
  ExtendedV0Transaction,
  InstructionsWrapper,
  makeWrapSolIxs,
  TransactionType,
} from "~/services/transaction";
import { WSOL_MINT } from "~/constants";

import { fetchGammaLpVault, resolveVaultTokenProgram } from "../utils";
import type { MakeVaultDepositIxParams, MakeVaultDepositTxParams } from "../types";

/**
 * Build the instruction to deposit into a Gamma LP vault. Instant deposit —
 * the user receives vault shares in the same transaction. The program creates
 * the user's share ATA and deposit receipt if they do not yet exist.
 *
 * `amount` is interpreted as raw base units of the vault's asset mint.
 */
export async function makeVaultDepositIx(
  params: MakeVaultDepositIxParams
): Promise<InstructionsWrapper> {
  const { amount, user, lpVault, connection } = params;

  const vault = await fetchGammaLpVault(connection, lpVault);
  const tokenProgram =
    params.tokenProgram ?? (await resolveVaultTokenProgram(connection, vault.assetsMint));

  const [withdrawalPolicy] = deriveGammaWithdrawalPolicy(lpVault);
  const [depositReceipt] = deriveGammaDepositReceipt(user, lpVault);
  const userAssetAta = deriveGammaAta(vault.assetsMint, user, tokenProgram);
  const userShareAta = deriveGammaAta(vault.sharesMint, user, tokenProgram);

  const amountNative = new BN(new BigNumber(amount).toFixed(0));

  // Native-SOL vault: the deposit spends WSOL from the user's asset ATA, but the
  // user holds native SOL (no WSOL ATA → "AccountOwnedByWrongProgram"). Wrap the
  // deposit amount into the WSOL ATA first (idempotent create + fund + sync).
  // `makeWrapSolIxs` takes a UI amount; the asset is WSOL (9 decimals).
  const wrapIxs: TransactionInstruction[] = vault.assetsMint.equals(WSOL_MINT)
    ? makeWrapSolIxs(user, new BigNumber(amountNative.toString()).shiftedBy(-9))
    : [];

  // The Gamma deposit ix does NOT create the user's share ATA — a first-time
  // depositor has none, so the (System-owned) account fails the deposit's token
  // constraint with "AccountOwnedByWrongProgram". Idempotently create it first.
  const createShareAtaIx = createAssociatedTokenAccountIdempotentInstruction(
    user,
    userShareAta,
    user,
    vault.sharesMint,
    tokenProgram
  );

  const ix = makeGammaDepositIx(
    {
      user,
      lpVault,
      withdrawalPolicy,
      assetsAccount: vault.assetsAccount,
      userAssetAta,
      userShareAta,
      depositReceipt,
      assetsMint: vault.assetsMint,
      sharesMint: vault.sharesMint,
      tokenProgram,
    },
    amountNative
  );

  const instructions: TransactionInstruction[] = [
    ...wrapIxs,
    createShareAtaIx,
    ix,
  ];

  return { instructions, keys: [] };
}

/** Build a versioned transaction to deposit into a Gamma LP vault. */
export async function makeVaultDepositTx(
  params: MakeVaultDepositTxParams
): Promise<ExtendedV0Transaction> {
  const { connection, user, luts, blockhash: providedBlockhash } = params;

  const { instructions, keys } = await makeVaultDepositIx(params);

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
    type: TransactionType.VAULT_DEPOSIT,
  });
}
