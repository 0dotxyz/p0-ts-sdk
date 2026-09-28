import { getMergeInstruction } from "@solana-program/stake";

import type { MakeMergeStakeAccountsTxParams } from "../types";

import { makeTransactionMessage, SolanaTransaction, TransactionType } from "~/services/transaction";

/**
 * Builds a transaction merging `sourceStakeAccount` into `destinationStakeAccount`; both need the
 * same authority and vote account. The authority pays and signs; `latestBlockhash` is fetched when
 * omitted.
 */
export async function makeMergeStakeAccountsTx({
  rpc,
  luts,
  latestBlockhash,
  authority,
  sourceStakeAccount,
  destinationStakeAccount,
}: MakeMergeStakeAccountsTxParams): Promise<SolanaTransaction> {
  return {
    message: makeTransactionMessage({
      instructions: [
        getMergeInstruction({
          destinationStake: destinationStakeAccount,
          sourceStake: sourceStakeAccount,
          stakeAuthority: authority,
        }),
      ],
      feePayer: authority,
      latestBlockhash:
        latestBlockhash ?? (await rpc.getLatestBlockhash({ commitment: "confirmed" }).send()).value,
      luts,
    }),
    type: TransactionType.MERGE_STAKE_ACCOUNTS,
  };
}
