import {
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";

import { MakeBorrowIxParams, MakeBorrowTxParams, TransactionBuilderResult } from "../types";
import { computeHealthAccountMetas, computeHealthCheckAccounts } from "../utils";

import instructions from "~/instructions";
import { makeRefreshIntegrationBanksIxs, makeSmartCrankSwbFeedIx } from "~/services/price";
import {
  addTransactionMetadata,
  ExtendedV0Transaction,
  InstructionsWrapper,
  makeUnwrapSolIx,
  selectLutsForAccountAction,
  TransactionType,
} from "~/services/transaction";
import syncInstructions from "~/sync-instructions";
import { uiToNative } from "~/utils";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
  NATIVE_MINT,
  TOKEN_2022_PROGRAM_ID,
} from "~/vendor/spl";


export async function makeBorrowIx({
  program,
  bank,
  bankMap,
  tokenProgram,
  amount,
  marginfiAccount,
  authority,
  isSync,
  opts = {},
}: MakeBorrowIxParams): Promise<InstructionsWrapper> {
  const wrapAndUnwrapSol = opts.wrapAndUnwrapSol ?? true;
  const createAtas = opts.createAtas ?? true;

  const borrowIxs: TransactionInstruction[] = [];

  const userAta = getAssociatedTokenAddressSync(bank.mint, authority, true, tokenProgram); // We allow off curve addresses here to support Fuse.

  if (createAtas) {
    const createAtaIdempotentIx = createAssociatedTokenAccountIdempotentInstruction(
      authority,
      userAta,
      authority,
      bank.mint,
      tokenProgram
    );
    borrowIxs.push(createAtaIdempotentIx);
  }

  // Combine the borrow bank with any additional health check banks
  // (e.g., deposit bank in a combined deposit-borrow operation)
  const mandatoryBanks = [bank.address, ...(opts.additionalHealthCheckBanks ?? [])];

  const healthAccounts = computeHealthCheckAccounts({
    account: marginfiAccount,
    banksMap: bankMap,
    mandatoryBanks,
  });

  const remainingAccounts: PublicKey[] = [];

  if (tokenProgram.equals(TOKEN_2022_PROGRAM_ID)) {
    remainingAccounts.push(bank.mint);
  }
  if (opts?.observationBanksOverride) {
    remainingAccounts.push(...opts.observationBanksOverride);
  } else {
    const accountMetas = computeHealthAccountMetas({ banksToInclude: healthAccounts });
    remainingAccounts.push(...accountMetas);
  }

  const borrowIx = isSync
    ? syncInstructions.makeBorrowIx(
        program.programId,
        {
          marginfiAccount: marginfiAccount.address,
          bank: bank.address,
          destinationTokenAccount: userAta,
          tokenProgram: tokenProgram,
          authority: opts?.overrideInferAccounts?.authority ?? marginfiAccount.authority,
          group: opts?.overrideInferAccounts?.group ?? marginfiAccount.group,
        },
        { amount: uiToNative(amount, bank.mintDecimals) },
        remainingAccounts.map((account) => ({
          pubkey: account,
          isSigner: false,
          isWritable: false,
        }))
      )
    : await instructions.makeBorrowIx(
        program,
        {
          marginfiAccount: marginfiAccount.address,
          bank: bank.address,
          destinationTokenAccount: userAta,
          tokenProgram: tokenProgram,
          authority: opts?.overrideInferAccounts?.authority,
          group: opts?.overrideInferAccounts?.group,
        },
        { amount: uiToNative(amount, bank.mintDecimals) },
        remainingAccounts.map((account) => ({
          pubkey: account,
          isSigner: false,
          isWritable: false,
        }))
      );
  borrowIxs.push(borrowIx);

  if (bank.mint.equals(NATIVE_MINT) && wrapAndUnwrapSol) {
    borrowIxs.push(makeUnwrapSolIx(authority));
  }

  return {
    instructions: borrowIxs,
    keys: [],
  };
}

export async function makeBorrowTx(params: MakeBorrowTxParams): Promise<TransactionBuilderResult> {
  const { luts, connection, ...borrowIxParams } = params;

  // Pick the lean native-stake LUT subset when every involved bank (target + the
  // account's active positions + any extra health-check banks) is STAKED/SOL.
  const selectedLuts = selectLutsForAccountAction(
    luts,
    borrowIxParams.bank,
    params.marginfiAccount.balances,
    params.bankMap,
    borrowIxParams.opts?.additionalHealthCheckBanks
  );

  const refreshIntegrationIxs = makeRefreshIntegrationBanksIxs(
    params.marginfiAccount,
    params.bankMap,
    [borrowIxParams.bank.address],
    params.bankMetadataMap
  );

  const borrowIxs = await makeBorrowIx(borrowIxParams);

  const { instructions: updateFeedIxs, luts: feedLuts } = await makeSmartCrankSwbFeedIx({
    marginfiAccount: params.marginfiAccount,
    bankMap: params.bankMap,
    oraclePrices: params.oraclePrices,
    assetShareValueMultiplierByBank: params.assetShareValueMultiplierByBank,
    instructions: borrowIxs.instructions,
    program: params.program,
    connection: params.connection,
    crossbarUrl: params.crossbarUrl,
  });

  const {
    value: { blockhash },
  } = await connection.getLatestBlockhashAndContext("confirmed");

  const feedCrankTxs: ExtendedV0Transaction[] = [];

  if (updateFeedIxs.length > 0) {
    feedCrankTxs.push(
      addTransactionMetadata(
        new VersionedTransaction(
          new TransactionMessage({
            instructions: updateFeedIxs,
            payerKey: params.authority,
            recentBlockhash: blockhash,
          }).compileToV0Message(feedLuts)
        ),
        {
          addressLookupTables: feedLuts,
          type: TransactionType.CRANK,
        }
      )
    );
  }

  const borrowTx = addTransactionMetadata(
    new VersionedTransaction(
      new TransactionMessage({
        instructions: [...refreshIntegrationIxs.instructions, ...borrowIxs.instructions],
        payerKey: params.authority,
        recentBlockhash: blockhash,
      }).compileToV0Message(selectedLuts)
    ),
    {
      signers: [...refreshIntegrationIxs.keys, ...borrowIxs.keys],
      addressLookupTables: selectedLuts,
      type: TransactionType.BORROW,
    }
  );

  const transactions = [...feedCrankTxs, borrowTx];
  return { transactions, actionTxIndex: transactions.length - 1 };
}
