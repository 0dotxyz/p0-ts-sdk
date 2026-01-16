import {
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";

import instructions from "~/instructions";
import {
  addTransactionMetadata,
  ExtendedV0Transaction,
  InstructionsWrapper,
  makeUnwrapSolIx,
  TransactionType,
} from "~/services/transaction";
import { makeRefreshKaminoBanksIxs, makeSmartCrankSwbFeedIx } from "~/services/price";
import syncInstructions from "~/sync-instructions";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
  NATIVE_MINT,
  TOKEN_2022_PROGRAM_ID,
} from "~/vendor/spl";
import { uiToNative } from "~/utils";

import { computeHealthAccountMetas, computeHealthCheckAccounts } from "../utils";
import { MakeBorrowIxParams, MakeBorrowTxParams, TransactionBuilderResult } from "../types";

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

  const healthAccounts = computeHealthCheckAccounts(
    marginfiAccount.balances,
    bankMap,
    [bank.address],
    []
  );

  const remainingAccounts: PublicKey[] = [];

  if (tokenProgram.equals(TOKEN_2022_PROGRAM_ID)) {
    remainingAccounts.push(bank.mint);
  }
  if (opts?.observationBanksOverride) {
    remainingAccounts.push(...opts.observationBanksOverride);
  } else {
    const accountMetas = computeHealthAccountMetas(healthAccounts);
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

  const updateDriftMarketIxs = makeUpdateDriftMarketIxs(
    params.marginfiAccount,
    params.bankMap,
    [borrowIxParams.bank.address],
    params.bankMetadataMap
  );

  const refreshIxs = makeRefreshKaminoBanksIxs(
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
    instructions: borrowIxs.instructions,
    program: params.program,
    connection: params.connection,
    crossbarUrl: params.crossbarUrl,
  });

  const {
    value: { blockhash },
  } = await connection.getLatestBlockhashAndContext("confirmed");

  let feedCrankTxs: ExtendedV0Transaction[] = [];

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
        instructions: [
          ...refreshIxs.instructions,
          ...updateDriftMarketIxs.instructions,
          ...borrowIxs.instructions,
        ],
        payerKey: params.authority,
        recentBlockhash: blockhash,
      }).compileToV0Message(luts)
    ),
    {
      signers: [...refreshIxs.keys, ...borrowIxs.keys],
      addressLookupTables: luts,
      type: TransactionType.BORROW,
    }
  );

  const transactions = [...feedCrankTxs, borrowTx];
  return { transactions, actionTxIndex: transactions.length - 1 };
}
