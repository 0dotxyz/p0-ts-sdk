import {
  AddressLookupTableAccount,
  ComputeBudgetProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";

import {
  addTransactionMetadata,
  ExtendedV0Transaction,
  getWritableAccountKeys,
  getTxSize,
  getTotalAccountKeys,
  InstructionsWrapper,
  splitInstructionsToFitTransactions,
  TransactionType,
} from "~/services/transaction";
import {
  makeRefreshKaminoBanksIxs,
  makeSmartCrankSwbFeedIx,
  makeUpdateDriftMarketIxs,
  makeUpdateJupLendRateIxs,
} from "~/services/price";
import { TransactionBuildingError } from "~/errors";
import { MAX_TX_SIZE, MAX_ACCOUNT_LOCKS } from "~/constants";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "~/vendor/spl";
import { nativeToUi, uiToNative } from "~/utils";

import {
  getSwapIxsForFlashloan,
  getExactOutEstimate,
  isWholePosition,
  computeFlashloanSwapConstraints,
  compileFlashloanPrecheck,
} from "../utils";
import { MakeSwapDebtTxParams, SwapProvider, SwapQuoteResult } from "../types";

import { makeSetupIx } from "./account-lifecycle";
import { makeBorrowIx } from "./borrow";
import { makeRepayIx } from "./repay";
import { makeFlashLoanTx } from "./flash-loan";

/**
 * Creates transactions to swap one debt position to another using a flash loan.
 *
 * This allows users to change their debt type (e.g., USDC debt -> SOL debt) without
 * repaying and affecting their health during the swap.
 *
 * @example
 * const { transactions, actionTxIndex, quoteResponse } = await makeSwapDebtTx({
 *   program,
 *   marginfiAccount,
 *   connection,
 *   bankMap,
 *   oraclePrices,
 *   repayOpts: { totalPositionAmount: 100, repayBank: usdcBank, tokenProgram },
 *   borrowOpts: { borrowBank: solBank, tokenProgram },
 *   swapOpts: { swapConfig: { provider: SwapProvider.JUPITER, slippageMode: "DYNAMIC", slippageBps: 50, platformFeeBps: 0 } },
 *   // ...
 * });
 */
export async function makeSwapDebtTx(params: MakeSwapDebtTxParams): Promise<{
  transactions: ExtendedV0Transaction[];
  actionTxIndex: number;
  quoteResponse: SwapQuoteResult | undefined;
}> {
  const {
    program,
    marginfiAccount,
    connection,
    bankMap,
    oraclePrices,
    repayOpts,
    borrowOpts,
    bankMetadataMap,
    assetShareValueMultiplierByBank,
    addressLookupTableAccounts,
    crossbarUrl,
    additionalIxs = [],
  } = params;

  const blockhash = (await connection.getLatestBlockhash("confirmed")).blockhash;

  const setupIxs = await makeSetupIx({
    connection,
    authority: marginfiAccount.authority,
    tokens: [
      { mint: repayOpts.repayBank.mint, tokenProgram: repayOpts.tokenProgram },
      { mint: borrowOpts.borrowBank.mint, tokenProgram: borrowOpts.tokenProgram },
    ],
  });

  const updateJupLendRateIxs = makeUpdateJupLendRateIxs(
    params.marginfiAccount,
    params.bankMap,
    [],
    params.bankMetadataMap
  );

  const updateDriftMarketIxs = makeUpdateDriftMarketIxs(
    marginfiAccount,
    bankMap,
    [],
    bankMetadataMap
  );

  // Build Kamino refresh instructions (returns empty if no Kamino banks involved)
  const kaminoRefreshIxs = makeRefreshKaminoBanksIxs(
    marginfiAccount,
    bankMap,
    [repayOpts.repayBank.address, borrowOpts.borrowBank.address],
    bankMetadataMap
  );

  const { flashloanTx, setupInstructions, swapQuote, borrowIxs, repayIxs } =
    await buildSwapDebtFlashloanTx({
      ...params,
      blockhash,
    });

  // Filter Jupiter setup instructions to avoid duplicates with our setup
  const jupiterSetupInstructions = setupInstructions.filter((ix) => {
    // Filter out compute budget instructions
    if (ix.programId.equals(ComputeBudgetProgram.programId)) {
      return false;
    }

    if (ix.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID)) {
      // Key 3 is always mint in create ATA instruction
      const mintKey = ix.keys[3]?.pubkey;

      if (
        mintKey?.equals(repayOpts.repayBank.mint) ||
        mintKey?.equals(borrowOpts.borrowBank.mint)
      ) {
        return false;
      }
    }

    return true;
  });

  setupIxs.push(...jupiterSetupInstructions);

  const { instructions: updateFeedIxs, luts: feedLuts } = await makeSmartCrankSwbFeedIx({
    marginfiAccount,
    bankMap,
    oraclePrices,
    assetShareValueMultiplierByBank,
    instructions: [...borrowIxs.instructions, ...repayIxs.instructions],
    program,
    connection,
    crossbarUrl,
  });

  let additionalTxs: ExtendedV0Transaction[] = [];

  // If ATAs, additional instructions, or refreshes are needed, add them
  if (
    setupIxs.length > 0 ||
    kaminoRefreshIxs.instructions.length > 0 ||
    updateDriftMarketIxs.instructions.length > 0 ||
    updateJupLendRateIxs.instructions.length > 0
  ) {
    const ixs = [
      ...additionalIxs,
      ...setupIxs,
      ...kaminoRefreshIxs.instructions,
      ...updateDriftMarketIxs.instructions,
      ...updateJupLendRateIxs.instructions,
    ];
    const txs = splitInstructionsToFitTransactions([], ixs, {
      blockhash,
      payerKey: marginfiAccount.authority,
      luts: addressLookupTableAccounts ?? [],
    });

    additionalTxs.push(
      ...txs.map((tx) =>
        addTransactionMetadata(tx, {
          type: TransactionType.CREATE_ATA,
          addressLookupTables: addressLookupTableAccounts,
        })
      )
    );
  }

  // If crank is needed, add it
  if (updateFeedIxs.length > 0) {
    const message = new TransactionMessage({
      payerKey: marginfiAccount.authority,
      recentBlockhash: blockhash,
      instructions: updateFeedIxs,
    }).compileToV0Message(feedLuts);

    additionalTxs.push(
      addTransactionMetadata(new VersionedTransaction(message), {
        addressLookupTables: feedLuts,
        type: TransactionType.CRANK,
      })
    );
  }

  const transactions = [...additionalTxs, flashloanTx];

  return {
    transactions,
    actionTxIndex: transactions.length - 1,
    quoteResponse: swapQuote,
  };
}

async function buildSwapDebtFlashloanTx({
  program,
  marginfiAccount,
  bankMap,
  repayOpts,
  borrowOpts,
  swapOpts,
  bankMetadataMap,
  addressLookupTableAccounts,
  connection,
  overrideInferAccounts,
  blockhash,
}: MakeSwapDebtTxParams & { blockhash: string }) {
  const {
    repayBank,
    tokenProgram: repayTokenProgram,
    totalPositionAmount,
    repayAmount,
  } = repayOpts;
  const { borrowBank, tokenProgram: borrowTokenProgram } = borrowOpts;

  // Validate and clamp repayAmount
  if (repayAmount !== undefined && repayAmount <= 0) {
    throw new Error("repayAmount must be greater than 0");
  }

  // Use repayAmount if provided, otherwise use totalPositionAmount (full swap)
  // Clamp to totalPositionAmount to prevent repaying more than owed
  const actualRepayAmount = Math.min(repayAmount ?? totalPositionAmount, totalPositionAmount);

  const cuRequestIxs = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: 1_200_000 }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1 }),
  ];

  const destinationTokenAccount = getAssociatedTokenAddressSync(
    repayBank.mint,
    marginfiAccount.authority,
    true,
    repayTokenProgram.equals(TOKEN_2022_PROGRAM_ID) ? TOKEN_2022_PROGRAM_ID : undefined
  );

  // Step 1: Get an estimate of how much to borrow using ExactOut quote
  // This tells us the maximum input needed to get the desired output
  const { otherAmountThreshold } = await getExactOutEstimate({
    inputMint: borrowBank.mint.toBase58(),
    outputMint: repayBank.mint.toBase58(),
    amount: uiToNative(actualRepayAmount, repayBank.mintDecimals).toNumber(),
    swapOpts,
    connection,
  });

  // Use otherAmountThreshold (max input with slippage) as our borrow amount estimate
  const estimatedBorrowAmount = nativeToUi(otherAmountThreshold, borrowBank.mintDecimals);

  const swapConstraints = await computeFlashloanSwapConstraints({
    program,
    marginfiAccount,
    bankMap,
    bankMetadataMap,
    addressLookupTableAccounts: addressLookupTableAccounts ?? [],
    primaryIx: { type: "borrow", bank: borrowBank, tokenProgram: borrowTokenProgram },
    secondaryIx: { type: "repay", bank: repayBank, tokenProgram: repayTokenProgram },
    overrideInferAccounts,
  });

  // Step 2: Get the actual swap instructions using ExactIn mode
  // This is more reliable as we know exactly how much we're borrowing
  const swapResponses = await getSwapIxsForFlashloan({
    inputMint: borrowBank.mint.toBase58(),
    outputMint: repayBank.mint.toBase58(),
    amount: uiToNative(estimatedBorrowAmount, borrowBank.mintDecimals).toNumber(),
    swapMode: "ExactIn",
    authority: marginfiAccount.authority,
    connection,
    destinationTokenAccount,
    swapOpts,
    sizeConstraint: swapConstraints.sizeConstraint,
    maxSwapTotalAccounts: swapConstraints.maxSwapTotalAccounts,
  });

  const { quoteResponse } = swapResponses;
  const outAmount = nativeToUi(quoteResponse.outAmount, repayBank.mintDecimals);
  const outAmountThreshold = nativeToUi(quoteResponse.otherAmountThreshold, repayBank.mintDecimals);

  // If output exceeds total debt, cap at total debt (for repayAll)
  // Otherwise use minimum output with slippage protection
  const amountToRepay = outAmount > totalPositionAmount ? totalPositionAmount : outAmountThreshold;

  // For ExactIn, inAmount is what we borrow
  const borrowAmount = nativeToUi(quoteResponse.inAmount, borrowBank.mintDecimals);

  // Build borrow instruction (new debt)
  const borrowIxs = await makeBorrowIx({
    program,
    bank: borrowBank,
    bankMap,
    tokenProgram: borrowTokenProgram,
    amount: borrowAmount,
    marginfiAccount,
    authority: marginfiAccount.authority,
    isSync: true,
    opts: {
      createAtas: false,
      wrapAndUnwrapSol: false,
      overrideInferAccounts,
    },
  });

  // Build repay instruction (old debt)
  const repayIxs = await makeRepayIx({
    program,
    bank: repayBank,
    tokenProgram: repayTokenProgram,
    amount: amountToRepay,
    accountAddress: marginfiAccount.address,
    authority: marginfiAccount.authority,
    repayAll: isWholePosition(
      {
        amount: totalPositionAmount,
        isLending: false,
      },
      amountToRepay,
      repayBank.mintDecimals
    ),
    isSync: true,
    opts: {
      wrapAndUnwrapSol: false,
      overrideInferAccounts,
    },
  });

  const luts = [
    ...(addressLookupTableAccounts ?? []),
    ...swapResponses.addressLookupTableAddresses,
  ];

  const allNonFlIxs = [
    ...cuRequestIxs,
    ...borrowIxs.instructions,
    ...swapResponses.swapInstructions,
    ...repayIxs.instructions,
  ];

  compileFlashloanPrecheck({
    allIxs: allNonFlIxs,
    payer: marginfiAccount.authority,
    luts,
    sizeConstraint: swapConstraints.sizeConstraint,
    swapIxCount: swapResponses.swapInstructions.length,
    swapLutCount: swapResponses.addressLookupTableAddresses.length,
  });

  // Wallets add a priority fee ix by default breaking the flashloan tx so we need to add a placeholder priority fee ix
  // docs: https://docs.phantom.app/developer-powertools/solana-priority-fees
  // Solflare requires you to also include the set compute unit price to avoid transaction rejection on flashloans.
  const flashloanTx = await makeFlashLoanTx({
    program,
    marginfiAccount,
    bankMap,
    addressLookupTableAccounts: luts,
    blockhash,
    ixs: allNonFlIxs,
    isSync: true,
  });

  const txSize = getTxSize(flashloanTx);
  const totalKeys = getTotalAccountKeys(flashloanTx);

  if (txSize > MAX_TX_SIZE || totalKeys > MAX_ACCOUNT_LOCKS) {
    throw TransactionBuildingError.swapSizeExceededLoop(
      txSize,
      totalKeys,
      swapOpts.swapConfig?.provider
    );
  }

  return {
    flashloanTx,
    setupInstructions: swapResponses.setupInstructions,
    swapQuote: quoteResponse,
    borrowIxs,
    repayIxs,
  };
}
