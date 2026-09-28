import type { Instruction } from "@solana/kit";
import { findAssociatedTokenPda } from "@solana-program/token";
import { BigNumber } from "bignumber.js";

import type {
  MakeVaultCompleteWithdrawalIxParams,
  MakeVaultCompleteWithdrawalTxParams,
  MakeVaultWithdrawIxParams,
  MakeVaultWithdrawTxParams,
} from "../types";
import { fetchGammaLpVault, resolveVaultTokenProgram } from "../utils";

import { DEFAULT_ADDRESS } from "~/constants";
import { makeTransactionMessage, SolanaTransaction, TransactionType } from "~/services/transaction";
import { deriveGammaWithdrawEscrow } from "~/vendor/gamma";
import { makeGammaCompleteWithdrawalIx, makeGammaWithdrawIx } from "~/vendor/gamma/instructions";

/**
 * Starts a withdrawal of `sharesAmount` (share mint base units) from a Gamma LP vault: the shares
 * are escrowed and queued in the authority's withdraw receipt until a keeper fulfills them; then
 * {@link makeVaultCompleteWithdrawalIx} claims the assets.
 * @throws if `lpVault` doesn't exist or isn't an `LpVault`
 */
export async function makeVaultWithdrawIx({
  rpc,
  authority,
  lpVault,
  tokenProgram,
  sharesAmount,
}: MakeVaultWithdrawIxParams): Promise<Instruction[]> {
  const vault = await fetchGammaLpVault(rpc, lpVault);
  const vaultTokenProgram = tokenProgram ?? (await resolveVaultTokenProgram(rpc, vault.assetsMint));

  // `fee_recipient` is the share token account that receives fee shares and is passed as-is. With
  // fees off it's the default address, and the program still deserializes whatever fills the slot,
  // so the historical placeholder (the default address's asset ATA, which exists on-chain) is sent.
  const [feeRecipientAccount] =
    vault.feeRecipient === DEFAULT_ADDRESS
      ? await findAssociatedTokenPda({
          mint: vault.assetsMint,
          owner: DEFAULT_ADDRESS,
          tokenProgram: vaultTokenProgram,
        })
      : [vault.feeRecipient];

  return [
    await makeGammaWithdrawIx({
      user: authority,
      lpVault,
      assetsAccount: vault.assetsAccount,
      assetsMint: vault.assetsMint,
      sharesMint: vault.sharesMint,
      feeRecipientAccount,
      tokenProgram: vaultTokenProgram,
      sharesAmount: BigInt(new BigNumber(sharesAmount).toFixed(0)),
    }),
  ];
}

/**
 * Builds a transaction around {@link makeVaultWithdrawIx}. The authority pays and signs;
 * `latestBlockhash` is fetched when omitted.
 * @throws see {@link makeVaultWithdrawIx}
 */
export async function makeVaultWithdrawTx(
  params: MakeVaultWithdrawTxParams
): Promise<SolanaTransaction> {
  const { luts, latestBlockhash, ...withdrawIxParams } = params;

  const withdrawIxs = await makeVaultWithdrawIx(withdrawIxParams);

  return {
    message: makeTransactionMessage({
      instructions: withdrawIxs,
      feePayer: params.authority,
      latestBlockhash:
        latestBlockhash ??
        (await params.rpc.getLatestBlockhash({ commitment: "confirmed" }).send()).value,
      luts,
    }),
    type: TransactionType.VAULT_WITHDRAW,
  };
}

/**
 * Claims a fulfilled Gamma withdrawal: moves the claimable assets from the withdraw escrow to the
 * authority's asset ATA (created by the program if needed).
 * @throws if `lpVault` doesn't exist or isn't an `LpVault`
 */
export async function makeVaultCompleteWithdrawalIx({
  rpc,
  authority,
  lpVault,
  tokenProgram,
}: MakeVaultCompleteWithdrawalIxParams): Promise<Instruction[]> {
  const vault = await fetchGammaLpVault(rpc, lpVault);
  const vaultTokenProgram = tokenProgram ?? (await resolveVaultTokenProgram(rpc, vault.assetsMint));
  const [withdrawEscrow] = await deriveGammaWithdrawEscrow(authority.address, lpVault);
  const [[escrowAssetsAccount], [escrowSharesAccount]] = await Promise.all(
    [vault.assetsMint, vault.sharesMint].map((mint) =>
      findAssociatedTokenPda({ mint, owner: withdrawEscrow, tokenProgram: vaultTokenProgram })
    )
  );

  return [
    await makeGammaCompleteWithdrawalIx({
      user: authority,
      lpVault,
      assetsMint: vault.assetsMint,
      sharesMint: vault.sharesMint,
      escrowAssetsAccount,
      escrowSharesAccount,
      tokenProgram: vaultTokenProgram,
    }),
  ];
}

/**
 * Builds a transaction around {@link makeVaultCompleteWithdrawalIx}. The authority pays and signs;
 * `latestBlockhash` is fetched when omitted.
 * @throws see {@link makeVaultCompleteWithdrawalIx}
 */
export async function makeVaultCompleteWithdrawalTx(
  params: MakeVaultCompleteWithdrawalTxParams
): Promise<SolanaTransaction> {
  const { luts, latestBlockhash, ...completeIxParams } = params;

  const completeIxs = await makeVaultCompleteWithdrawalIx(completeIxParams);

  return {
    message: makeTransactionMessage({
      instructions: completeIxs,
      feePayer: params.authority,
      latestBlockhash:
        latestBlockhash ??
        (await params.rpc.getLatestBlockhash({ commitment: "confirmed" }).send()).value,
      luts,
    }),
    type: TransactionType.VAULT_COMPLETE_WITHDRAWAL,
  };
}
