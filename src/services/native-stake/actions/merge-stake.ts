import { StakeProgram, TransactionMessage, VersionedTransaction } from "@solana/web3.js";

import {
  addTransactionMetadata,
  ExtendedV0Transaction,
  TransactionType,
} from "~/services/transaction";

import type { MakeMergeStakeAccountsTxParams } from "../types";

/**
 * Creates a versioned transaction to merge two stake accounts.
 *
 * The source stake account will be merged into the destination stake account.
 * Both accounts must share the same authorized staker/withdrawer and vote account.
 */
export async function makeMergeStakeAccountsTx(
  params: MakeMergeStakeAccountsTxParams
): Promise<ExtendedV0Transaction> {
  const {
    authority,
    sourceStakeAccount,
    destinationStakeAccount,
    connection,
    luts,
    blockhash: providedBlockhash,
  } = params;

  const mergeIx = StakeProgram.merge({
    stakePubkey: destinationStakeAccount,
    sourceStakePubKey: sourceStakeAccount,
    authorizedPubkey: authority,
  }).instructions;

  const blockhash =
    providedBlockhash ?? (await connection.getLatestBlockhash("confirmed")).blockhash;

  const message = new TransactionMessage({
    payerKey: authority,
    recentBlockhash: blockhash,
    instructions: mergeIx,
  }).compileToV0Message(luts);

  const tx = new VersionedTransaction(message);

  return addTransactionMetadata(tx, {
    addressLookupTables: luts,
    type: TransactionType.MERGE_STAKE_ACCOUNTS,
  });
}
