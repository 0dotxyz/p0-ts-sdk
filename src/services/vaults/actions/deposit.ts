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
import {
  addTransactionMetadata,
  ExtendedV0Transaction,
  InstructionsWrapper,
  TransactionType,
} from "~/services/transaction";

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

  const instructions: TransactionInstruction[] = [ix];

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
