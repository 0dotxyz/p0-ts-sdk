import { generateKeyPairSigner, type Instruction } from "@solana/kit";
import { STAKE_PROGRAM_ADDRESS } from "@solana-program/stake";
import { getCreateAccountInstruction } from "@solana-program/system";
import {
  findAssociatedTokenPda,
  getApproveInstruction,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";

import type { MakeRedeemStakedLstIxParams, MakeRedeemStakedLstTxParams } from "../types";

import { STAKE_ACCOUNT_SIZE } from "~/constants";
import { makeTransactionMessage, SolanaTransaction, TransactionType } from "~/services/transaction";
import { uiToNative } from "~/utils";
import {
  findPoolAddress,
  findPoolMintAddress,
  findPoolMintAuthorityAddress,
  makeSinglePoolWithdrawStakeIx,
} from "~/vendor/single-spl-pool";

/**
 * Redeems `amount` LST (UI units) of the validator's single pool from the authority's ATA into a new
 * stake account owned by the authority, whose generated signer the instructions carry.
 */
export async function makeRedeemStakedLstIx({
  rpc,
  amount,
  authority,
  validator,
}: MakeRedeemStakedLstIxParams): Promise<Instruction[]> {
  const pool = await findPoolAddress(validator);
  const [lstMint, mintAuthority, stakeAccount, rentExemption] = await Promise.all([
    findPoolMintAddress(pool),
    findPoolMintAuthorityAddress(pool),
    generateKeyPairSigner(),
    rpc.getMinimumBalanceForRentExemption(STAKE_ACCOUNT_SIZE).send(),
  ]);
  const [lstAta] = await findAssociatedTokenPda({
    mint: lstMint,
    owner: authority.address,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
  });
  const tokenAmount = uiToNative(amount, 9);

  return [
    getCreateAccountInstruction({
      payer: authority,
      newAccount: stakeAccount,
      lamports: rentExemption,
      space: STAKE_ACCOUNT_SIZE,
      programAddress: STAKE_PROGRAM_ADDRESS,
    }),
    getApproveInstruction({
      source: lstAta,
      delegate: mintAuthority,
      owner: authority,
      amount: tokenAmount,
    }),
    await makeSinglePoolWithdrawStakeIx(
      pool,
      stakeAccount.address,
      authority.address,
      lstAta,
      tokenAmount
    ),
  ];
}

/**
 * Builds a transaction around {@link makeRedeemStakedLstIx}. The authority pays and signs;
 * `latestBlockhash` is fetched when omitted.
 */
export async function makeRedeemStakedLstTx(
  params: MakeRedeemStakedLstTxParams
): Promise<SolanaTransaction> {
  const { luts, latestBlockhash, version, ...redeemIxParams } = params;

  const redeemIxs = await makeRedeemStakedLstIx(redeemIxParams);

  return {
    message: makeTransactionMessage({
      instructions: redeemIxs,
      feePayer: params.authority,
      latestBlockhash:
        latestBlockhash ??
        (await params.rpc.getLatestBlockhash({ commitment: "confirmed" }).send()).value,
      luts,
      version,
    }),
    type: TransactionType.WITHDRAW_STAKE,
  };
}
