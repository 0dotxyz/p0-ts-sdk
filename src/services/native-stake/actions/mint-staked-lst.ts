import { generateKeyPairSigner, type Instruction } from "@solana/kit";
import {
  fetchStakeStateAccount,
  getAuthorizeInstruction,
  getSplitInstruction,
  STAKE_PROGRAM_ADDRESS,
  StakeAuthorize,
} from "@solana-program/stake";
import { getCreateAccountInstruction } from "@solana-program/system";
import {
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstruction,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";

import type { MakeMintStakedLstIxParams, MakeMintStakedLstTxParams } from "../types";

import { STAKE_ACCOUNT_SIZE } from "~/constants";
import { makeTransactionMessage, SolanaTransaction, TransactionType } from "~/services/transaction";
import { uiToNative } from "~/utils";
import {
  findPoolAddress,
  findPoolMintAddress,
  findPoolStakeAuthorityAddress,
  makeSinglePoolDepositStakeIx,
} from "~/vendor/single-spl-pool";

/**
 * Converts `amount` SOL (UI units) of `stakeAccount` into the validator's single-pool LST, sent to
 * the authority's ATA (created if missing). Less than the account's delegation is first split into
 * a new stake account, whose generated signer the instructions carry.
 * @throws if `stakeAccount` doesn't exist or isn't a stake account
 */
export async function makeMintStakedLstIx({
  rpc,
  amount,
  authority,
  stakeAccount,
  validator,
}: MakeMintStakedLstIxParams): Promise<Instruction[]> {
  const pool = await findPoolAddress(validator);
  const [lstMint, poolStakeAuthority, stake, rentExemption] = await Promise.all([
    findPoolMintAddress(pool),
    findPoolStakeAuthorityAddress(pool),
    fetchStakeStateAccount(rpc, stakeAccount),
    rpc.getMinimumBalanceForRentExemption(STAKE_ACCOUNT_SIZE).send(),
  ]);
  const [lstAta] = await findAssociatedTokenPda({
    mint: lstMint,
    owner: authority.address,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
  });
  const lamports = uiToNative(amount, 9);
  const delegated =
    stake.data.state.__kind === "Stake" ? stake.data.state.fields[1].delegation.stake : 0n;

  const mintIxs: Instruction[] = [
    getCreateAssociatedTokenIdempotentInstruction({
      payer: authority,
      ata: lstAta,
      owner: authority.address,
      mint: lstMint,
    }),
  ];

  let depositedStake = stakeAccount;
  if (lamports < delegated) {
    const splitStake = await generateKeyPairSigner();
    mintIxs.push(
      getCreateAccountInstruction({
        payer: authority,
        newAccount: splitStake,
        lamports: rentExemption,
        space: STAKE_ACCOUNT_SIZE,
        programAddress: STAKE_PROGRAM_ADDRESS,
      }),
      getSplitInstruction({
        stake: stakeAccount,
        splitStake: splitStake.address,
        stakeAuthority: authority,
        args: lamports,
      })
    );
    depositedStake = splitStake.address;
  }

  mintIxs.push(
    getAuthorizeInstruction({
      stake: depositedStake,
      authority,
      arg0: poolStakeAuthority,
      arg1: StakeAuthorize.Staker,
    }),
    getAuthorizeInstruction({
      stake: depositedStake,
      authority,
      arg0: poolStakeAuthority,
      arg1: StakeAuthorize.Withdrawer,
    }),
    await makeSinglePoolDepositStakeIx(pool, depositedStake, lstAta, authority.address)
  );

  return mintIxs;
}

/**
 * Builds a transaction around {@link makeMintStakedLstIx}. The authority pays and signs;
 * `latestBlockhash` is fetched when omitted.
 * @throws see {@link makeMintStakedLstIx}
 */
export async function makeMintStakedLstTx(
  params: MakeMintStakedLstTxParams
): Promise<SolanaTransaction> {
  const { luts, latestBlockhash, version, ...mintIxParams } = params;

  const mintIxs = await makeMintStakedLstIx(mintIxParams);

  return {
    message: makeTransactionMessage({
      instructions: mintIxs,
      feePayer: params.authority,
      latestBlockhash:
        latestBlockhash ??
        (await params.rpc.getLatestBlockhash({ commitment: "confirmed" }).send()).value,
      luts,
      version,
    }),
    type: TransactionType.DEPOSIT_STAKE,
  };
}
