import { QuoteResponse } from "@jup-ag/api";
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
  getAccountKeys,
  getTxSize,
  InstructionsWrapper,
  splitInstructionsToFitTransactions,
  TransactionType,
} from "~/services/transaction";
import { makeRefreshKaminoBanksIxs, makeSmartCrankSwbFeedIx } from "~/services/price";
import { TransactionBuildingError } from "~/errors";
import { MAX_TX_SIZE } from "~/constants";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "~/vendor/spl";
import { nativeToUi, uiToNative } from "~/utils";

import { getJupiterSwapIxsForFlashloan, isWholePosition } from "../utils";
import { MakeSwapDebtTxParams } from "../types";

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
 *   swapOpts: { jupiterOptions: { slippageMode: "DYNAMIC", slippageBps: 50 } },
 *   // ...
 * });
 */
export async function makeSwapDebtTx(params: MakeSwapDebtTxParams): Promise<{
  transactions: ExtendedV0Transaction[];
  actionTxIndex: number;
  quoteResponse: QuoteResponse | undefined;
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
    instructions: [...borrowIxs.instructions, ...repayIxs.instructions],
    program,
    connection,
    crossbarUrl,
  });

  let additionalTxs: ExtendedV0Transaction[] = [];

  // If ATAs, additional instructions, or refreshes are needed, add them
  if (setupIxs.length > 0 || additionalIxs.length > 0 || kaminoRefreshIxs.instructions.length > 0) {
    const ixs = [...additionalIxs, ...setupIxs, ...kaminoRefreshIxs.instructions];
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
  const { repayBank, tokenProgram: repayTokenProgram, totalPositionAmount } = repayOpts;
  const { borrowBank, tokenProgram: borrowTokenProgram } = borrowOpts;

  const swapResult: {
    amountToRepay: number;
    borrowAmount: number;
    swapInstructions: TransactionInstruction[];
    setupInstructions: TransactionInstruction[];
    swapLookupTables: AddressLookupTableAccount[];
    quoteResponse?: QuoteResponse;
  }[] = [];

  const cuRequestIxs = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: 1_200_000 }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1 }),
  ];

  // Handle same-mint case (no swap needed)
  if (borrowBank.mint.equals(repayBank.mint)) {
    swapResult.push({
      amountToRepay: totalPositionAmount,
      borrowAmount: totalPositionAmount,
      swapInstructions: [],
      setupInstructions: [],
      swapLookupTables: [],
    });
  } else {
    const destinationTokenAccount = getAssociatedTokenAddressSync(
      repayBank.mint,
      marginfiAccount.authority,
      true,
      repayTokenProgram.equals(TOKEN_2022_PROGRAM_ID) ? TOKEN_2022_PROGRAM_ID : undefined
    );

    // For debt swap, we need to borrow enough of the new asset to repay the old debt
    // We use ExactOut mode to get exactly the amount needed to repay

    // Get Jupiter swap instructions - may return multiple routes
    // We're swapping: borrowBank.mint (new debt) -> repayBank.mint (to repay old debt)
    const swapResponses = await getJupiterSwapIxsForFlashloan({
      quoteParams: {
        inputMint: borrowBank.mint.toBase58(),
        outputMint: repayBank.mint.toBase58(),
        amount: uiToNative(totalPositionAmount, repayBank.mintDecimals).toNumber(),
        dynamicSlippage: swapOpts.jupiterOptions
          ? swapOpts.jupiterOptions.slippageMode === "DYNAMIC"
          : true,
        slippageBps: swapOpts.jupiterOptions?.slippageBps,
        swapMode: "ExactOut",
        platformFeeBps: swapOpts.jupiterOptions?.platformFeeBps,
        onlyDirectRoutes: swapOpts.jupiterOptions?.directRoutesOnly ?? false,
      },
      authority: marginfiAccount.authority,
      connection,
      destinationTokenAccount,
    });

    swapResponses.forEach((response) => {
      // For ExactOut, inAmount is what we need to borrow, outAmount is what we'll repay
      const borrowAmount = nativeToUi(response.quoteResponse.inAmount, borrowBank.mintDecimals);

      swapResult.push({
        amountToRepay: totalPositionAmount,
        borrowAmount,
        swapInstructions: [response.swapInstruction],
        setupInstructions: response.setupInstructions,
        swapLookupTables: response.addressLookupTableAddresses,
        quoteResponse: response.quoteResponse,
      });
    });
  }

  // Ensure we have at least one swap route
  if (swapResult.length === 0) {
    throw new Error(
      `No swap routes found for ${borrowBank.mint.toBase58()} -> ${repayBank.mint.toBase58()}`
    );
  }

  // Try each swap route until we find one that fits in transaction limits
  for (const [index, item] of swapResult.entries()) {
    const {
      amountToRepay,
      borrowAmount,
      swapInstructions,
      setupInstructions,
      swapLookupTables,
      quoteResponse,
    } = item;

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

    const luts = [...(addressLookupTableAccounts ?? []), ...swapLookupTables];

    const flashloanParams = {
      program,
      marginfiAccount,
      bankMap,
      addressLookupTableAccounts: luts,
      blockhash,
    };

    // Wallets add a priority fee ix by default breaking the flashloan tx so we need to add a placeholder priority fee ix
    // docs: https://docs.phantom.app/developer-powertools/solana-priority-fees
    // Solflare requires you to also include the set compute unit price to avoid transaction rejection on flashloans.
    const flashloanTx = await makeFlashLoanTx({
      ...flashloanParams,
      ixs: [
        ...cuRequestIxs,
        ...borrowIxs.instructions,
        ...swapInstructions,
        ...repayIxs.instructions,
      ],
      isSync: true,
    });

    const txSize = getTxSize(flashloanTx);
    const keySize = getAccountKeys(flashloanTx, luts);
    const isLast = index === swapResult.length - 1;

    if (txSize > MAX_TX_SIZE || keySize > 64) {
      if (isLast) {
        throw TransactionBuildingError.jupiterSwapSizeExceededLoop(txSize, keySize);
      } else {
        continue;
      }
    } else {
      return {
        flashloanTx,
        setupInstructions,
        swapQuote: quoteResponse,
        borrowIxs,
        repayIxs,
      };
    }
  }

  throw new Error("Failed to build swap debt flashloan tx");
}
