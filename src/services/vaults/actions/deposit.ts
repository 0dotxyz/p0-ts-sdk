import type { Instruction } from "@solana/kit";
import {
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstruction,
} from "@solana-program/token";
import { BigNumber } from "bignumber.js";

import type { MakeVaultDepositIxParams, MakeVaultDepositTxParams } from "../types";
import { fetchGammaLpVault, resolveVaultTokenProgram } from "../utils";

import { WSOL_MINT } from "~/constants";
import {
  makeTransactionMessage,
  makeWrapSolIxs,
  SolanaTransaction,
  TransactionType,
} from "~/services/transaction";
import { makeGammaDepositIx } from "~/vendor/gamma/instructions";

/**
 * Deposits `amount` (asset mint base units) into a Gamma LP vault; the shares are minted in the
 * same transaction. A native-SOL vault first wraps the amount into the authority's wSOL ATA.
 * @throws if `lpVault` doesn't exist or isn't an `LpVault`
 */
export async function makeVaultDepositIx({
  rpc,
  authority,
  lpVault,
  tokenProgram,
  amount,
}: MakeVaultDepositIxParams): Promise<Instruction[]> {
  const vault = await fetchGammaLpVault(rpc, lpVault);
  const vaultTokenProgram = tokenProgram ?? (await resolveVaultTokenProgram(rpc, vault.assetsMint));
  const [userShareAta] = await findAssociatedTokenPda({
    mint: vault.sharesMint,
    owner: authority.address,
    tokenProgram: vaultTokenProgram,
  });
  const amountNative = BigInt(new BigNumber(amount).toFixed(0));

  return [
    ...(vault.assetsMint === WSOL_MINT
      ? await makeWrapSolIxs(authority, new BigNumber(amountNative.toString()).shiftedBy(-9))
      : []),
    // The deposit instruction doesn't create the share ATA a first-time depositor lacks.
    getCreateAssociatedTokenIdempotentInstruction({
      payer: authority,
      ata: userShareAta,
      owner: authority.address,
      mint: vault.sharesMint,
      tokenProgram: vaultTokenProgram,
    }),
    await makeGammaDepositIx({
      user: authority,
      lpVault,
      assetsAccount: vault.assetsAccount,
      assetsMint: vault.assetsMint,
      sharesMint: vault.sharesMint,
      tokenProgram: vaultTokenProgram,
      amount: amountNative,
    }),
  ];
}

/**
 * Builds a transaction around {@link makeVaultDepositIx}. The authority pays and signs;
 * `latestBlockhash` is fetched when omitted.
 * @throws see {@link makeVaultDepositIx}
 */
export async function makeVaultDepositTx(
  params: MakeVaultDepositTxParams
): Promise<SolanaTransaction> {
  const { luts, latestBlockhash, ...depositIxParams } = params;

  const depositIxs = await makeVaultDepositIx(depositIxParams);

  return {
    message: makeTransactionMessage({
      instructions: depositIxs,
      feePayer: params.authority,
      latestBlockhash:
        latestBlockhash ??
        (await params.rpc.getLatestBlockhash({ commitment: "confirmed" }).send()).value,
      luts,
    }),
    type: TransactionType.VAULT_DEPOSIT,
  };
}
