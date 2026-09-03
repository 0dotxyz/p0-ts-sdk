import {
  Keypair,
  StakeProgram,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import BigNumber from "bignumber.js";

import type { MakeRedeemStakedLstIxParams, MakeRedeemStakedLstTxParams } from "../types";

import {
  addTransactionMetadata,
  ExtendedV0Transaction,
  InstructionsWrapper,
  TransactionType,
} from "~/services/transaction";
import {
  SinglePoolInstruction,
  findPoolAddress,
  findPoolMintAddress,
  findPoolMintAuthorityAddress,
} from "~/vendor/single-spl-pool";
import { getAssociatedTokenAddressSync, createApproveInstruction } from "~/vendor/spl";

/**
 * Creates instructions to convert LST tokens back to a native stake account.
 *
 * Steps:
 * 1. Create new stake account (rent-exempt)
 * 2. Approve pool mint authority to burn LST
 * 3. Withdraw stake from pool → user receives stake account
 */
export async function makeRedeemStakedLstIx(
  params: MakeRedeemStakedLstIxParams
): Promise<InstructionsWrapper> {
  const { amount, authority, validator, connection } = params;

  // Derive addresses
  const pool = findPoolAddress(validator);
  const lstMint = findPoolMintAddress(pool);
  const mintAuthority = findPoolMintAuthorityAddress(pool);
  const lstAta = getAssociatedTokenAddressSync(lstMint, authority);

  // Calculate rent exemption for new stake account
  const rentExemption = await connection.getMinimumBalanceForRentExemption(StakeProgram.space);

  const stakeAmount = new BigNumber(new BigNumber(amount).toString());

  // Build instructions
  const instructions: TransactionInstruction[] = [];
  const signers: Keypair[] = [];

  // Create new stake account to receive the withdrawn stake
  const stakeAccount = Keypair.generate();
  signers.push(stakeAccount);

  instructions.push(
    SystemProgram.createAccount({
      fromPubkey: authority,
      newAccountPubkey: stakeAccount.publicKey,
      lamports: rentExemption,
      space: StakeProgram.space,
      programId: StakeProgram.programId,
    })
  );

  // Approve mint authority to burn LST tokens
  instructions.push(
    createApproveInstruction(
      lstAta,
      mintAuthority,
      authority,
      BigInt(stakeAmount.multipliedBy(1e9).toFixed(0))
    )
  );

  // Withdraw stake from pool (LST → stake account)
  const withdrawStakeIx = await SinglePoolInstruction.withdrawStake(
    pool,
    stakeAccount.publicKey,
    authority,
    lstAta,
    stakeAmount
  );
  instructions.push(withdrawStakeIx);

  return { instructions, keys: signers };
}

/**
 * Creates a versioned transaction to convert LST tokens back to a native stake account.
 */
export async function makeRedeemStakedLstTx(
  params: MakeRedeemStakedLstTxParams
): Promise<ExtendedV0Transaction> {
  const { connection, luts, blockhash: providedBlockhash } = params;

  const { instructions, keys } = await makeRedeemStakedLstIx(params);

  const blockhash =
    providedBlockhash ?? (await connection.getLatestBlockhash("confirmed")).blockhash;

  const message = new TransactionMessage({
    payerKey: params.authority,
    recentBlockhash: blockhash,
    instructions,
  }).compileToV0Message(luts);

  const tx = new VersionedTransaction(message);

  return addTransactionMetadata(tx, {
    signers: keys,
    addressLookupTables: luts,
    type: TransactionType.WITHDRAW_STAKE,
  });
}
