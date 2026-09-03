import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  StakeAuthorizationLayout,
  StakeProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";

import type { MakeMintStakedLstIxParams, MakeMintStakedLstTxParams } from "../types";

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
  findPoolStakeAuthorityAddress,
} from "~/vendor/single-spl-pool";
import {
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
} from "~/vendor/spl";

const SYSVAR_CLOCK_ID = new PublicKey("SysvarC1ock11111111111111111111111111111111");

/**
 * Creates instructions to convert a native stake account into LST tokens.
 *
 * Steps:
 * 1. Create LST ATA if needed
 * 2. Split stake account if partial amount
 * 3. Authorize staker + withdrawer to pool
 * 4. Deposit stake into pool → user receives LST
 */
export async function makeMintStakedLstIx(
  params: MakeMintStakedLstIxParams
): Promise<InstructionsWrapper> {
  const { amount, authority, stakeAccountPk, validator, connection } = params;

  // Derive addresses
  const pool = findPoolAddress(validator);
  const lstMint = findPoolMintAddress(pool);
  const poolStakeAuth = findPoolStakeAuthorityAddress(pool);
  const lstAta = getAssociatedTokenAddressSync(lstMint, authority);

  // Fetch account info
  const [lstAccInfo, stakeAccInfoParsed, rentExemptReserve] = await Promise.all([
    connection.getAccountInfo(lstAta),
    connection.getParsedAccountInfo(stakeAccountPk),
    connection.getMinimumBalanceForRentExemption(StakeProgram.space),
  ]);

  const stakeAccParsed = stakeAccInfoParsed?.value?.data as {
    parsed: { info: { stake?: { delegation?: { stake?: string } } } };
  };

  // Calculate amounts
  const amountLamports = Math.round(Number(amount) * LAMPORTS_PER_SOL);
  const stakeAccLamports = Number(stakeAccParsed?.parsed?.info?.stake?.delegation?.stake ?? 0);
  const isFullStake = amountLamports >= stakeAccLamports;

  // Build instructions
  const instructions: TransactionInstruction[] = [];
  const signers: Keypair[] = [];

  // Create ATA if needed
  if (!lstAccInfo) {
    instructions.push(
      createAssociatedTokenAccountInstruction(authority, lstAta, authority, lstMint)
    );
  }

  // Handle stake splitting if partial
  let targetStakePubkey: PublicKey;
  if (!isFullStake) {
    const splitStakeAccount = Keypair.generate();
    signers.push(splitStakeAccount);
    targetStakePubkey = splitStakeAccount.publicKey;

    instructions.push(
      ...StakeProgram.split(
        {
          stakePubkey: stakeAccountPk,
          authorizedPubkey: authority,
          splitStakePubkey: splitStakeAccount.publicKey,
          lamports: amountLamports,
        },
        rentExemptReserve
      ).instructions
    );
  } else {
    targetStakePubkey = stakeAccountPk;
  }

  // Authorize pool stake authority as staker + withdrawer
  const [authorizeStakerIx, authorizeWithdrawIx] = await Promise.all([
    StakeProgram.authorize({
      stakePubkey: targetStakePubkey,
      authorizedPubkey: authority,
      newAuthorizedPubkey: poolStakeAuth,
      stakeAuthorizationType: StakeAuthorizationLayout.Staker,
    }).instructions,
    StakeProgram.authorize({
      stakePubkey: targetStakePubkey,
      authorizedPubkey: authority,
      newAuthorizedPubkey: poolStakeAuth,
      stakeAuthorizationType: StakeAuthorizationLayout.Withdrawer,
    }).instructions,
  ]);

  // Fix SYSVAR_CLOCK_ID writability (known Solana SDK quirk)
  [authorizeStakerIx[0], authorizeWithdrawIx[0]].forEach((ix) => {
    if (ix) {
      ix.keys = ix.keys.map((key) => ({
        ...key,
        isWritable: key.pubkey.equals(SYSVAR_CLOCK_ID) ? false : key.isWritable,
      }));
    }
  });

  instructions.push(...authorizeStakerIx, ...authorizeWithdrawIx);

  // Deposit stake into pool → user receives LST
  const depositStakeIx = await SinglePoolInstruction.depositStake(
    pool,
    targetStakePubkey,
    lstAta,
    authority
  );
  instructions.push(depositStakeIx);

  return { instructions, keys: signers };
}

/**
 * Creates a versioned transaction to convert a native stake account into LST tokens.
 */
export async function makeMintStakedLstTx(
  params: MakeMintStakedLstTxParams
): Promise<ExtendedV0Transaction> {
  const { connection, luts, blockhash: providedBlockhash } = params;

  const { instructions, keys } = await makeMintStakedLstIx(params);

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
    type: TransactionType.DEPOSIT_STAKE,
  });
}
