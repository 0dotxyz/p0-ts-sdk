import { ComputeBudgetProgram, TransactionMessage, VersionedTransaction } from "@solana/web3.js";


import {
  computeBorrowEstimateForRepay,
  runSwapEngine,
  swapEngineProvidersFromOpts,
  swapEngineQuoteFieldsFromOpts,
} from "../services/swap-engine";
import { MakeSwapDebtTxParams, SwapQuoteResult } from "../types";
import {
  isWholePosition,
  computeFlashloanSwapConstraints,
  compileFlashloanPrecheck,
  BridgeOpts,
  BridgedTxResult,
  resolveTokenProgramForMint,
  selectSwapBridges,
  sharedBridgeLegContext,
  tryBridgeCandidates,
} from "../utils";

import { makeSetupIx } from "./account-lifecycle";
import { makeBorrowIx } from "./borrow";
import { composeBridgedSwap, mergeBridgeQuotesDebt } from "./bridge-swap";
import { makeFlashLoanTx } from "./flash-loan";
import { makeRepayIx } from "./repay";

import { MAX_TX_SIZE, MAX_ACCOUNT_LOCKS } from "~/constants";
import { isDecomposableSwapError, TransactionBuildingError } from "~/errors";
import { BankType } from "~/services/bank";
import { makeRefreshIntegrationBanksIxs, makeSmartCrankSwbFeedIx } from "~/services/price";
import {
  addTransactionMetadata,
  ExtendedV0Transaction,
  getTxSize,
  getTotalAccountKeys,
  splitInstructionsToFitTransactions,
  TransactionType,
} from "~/services/transaction";
import { nativeToUi, uiToNative } from "~/utils";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "~/vendor/spl";

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
  /** true → send as ONE atomic Jito bundle (integration refreshes go stale within a slot);
   *  false → sequential sends are safe (cranked oracles allow ≥ ~1 min staleness). */
  mustBeAtomicBundle: boolean;
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

  // No jup/drift exclusions here; kamino has no cpi so repay and borrow banks are
  // included in the refresh
  const refreshIntegrationIxs = makeRefreshIntegrationBanksIxs(
    marginfiAccount,
    bankMap,
    [],
    bankMetadataMap,
    [repayOpts.repayBank.address, borrowOpts.borrowBank.address]
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

  const additionalTxs: ExtendedV0Transaction[] = [];

  // If ATAs, additional instructions, or refreshes are needed, add them
  if (setupIxs.length > 0 || refreshIntegrationIxs.instructions.length > 0) {
    const ixs = [...additionalIxs, ...setupIxs, ...refreshIntegrationIxs.instructions];
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
    mustBeAtomicBundle: refreshIntegrationIxs.instructions.length > 0,
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
  swapEngineRunner,
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

  // Step 1: size the borrow from a market-price calculation — never a provider
  // ExactOut quote (Jupiter Router /build is ExactIn-only, and provider ExactOut
  // routes are unreliable). See computeBorrowEstimateForRepay for the buffering.
  const estimatedBorrowAmount = computeBorrowEstimateForRepay({
    repayTargetUi: actualRepayAmount,
    repayMarketPrice: repayOpts.marketPrice,
    borrowMarketPrice: borrowOpts.marketPrice,
    slippageBps: swapOpts.swapConfig?.slippageBps,
    isRepayAll: actualRepayAmount >= totalPositionAmount,
  });

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

  // Footprint for engine route sizing: borrow + repay ixs at estimate amounts (their
  // byte/account footprint is amount-independent). The real ixs are built from the
  // winning quote below.
  const footprintBorrowIxs = await makeBorrowIx({
    program,
    bank: borrowBank,
    bankMap,
    tokenProgram: borrowTokenProgram,
    amount: estimatedBorrowAmount,
    marginfiAccount,
    authority: marginfiAccount.authority,
    isSync: true,
    opts: { createAtas: false, wrapAndUnwrapSol: false, overrideInferAccounts },
  });
  const footprintRepayIxs = await makeRepayIx({
    program,
    bank: repayBank,
    tokenProgram: repayTokenProgram,
    amount: actualRepayAmount,
    accountAddress: marginfiAccount.address,
    authority: marginfiAccount.authority,
    isSync: true,
    opts: { wrapAndUnwrapSol: false, overrideInferAccounts },
  });

  // Step 2: run the multi-provider engine (ExactIn on the estimated borrow amount).
  const runEngine = swapEngineRunner ?? runSwapEngine;
  const engineResult = await runEngine({
    inputMint: borrowBank.mint.toBase58(),
    outputMint: repayBank.mint.toBase58(),
    amountNative: uiToNative(estimatedBorrowAmount, borrowBank.mintDecimals).toNumber(),
    inputDecimals: borrowBank.mintDecimals,
    outputDecimals: repayBank.mintDecimals,
    ...swapEngineQuoteFieldsFromOpts(swapOpts),
    taker: marginfiAccount.authority,
    destinationTokenAccount,
    connection,
    footprint: {
      instructions: [
        ...cuRequestIxs,
        ...footprintBorrowIxs.instructions,
        ...footprintRepayIxs.instructions,
      ],
      luts: addressLookupTableAccounts ?? [],
      payer: marginfiAccount.authority,
      sizeConstraint: swapConstraints.sizeConstraint,
      maxSwapTotalAccounts: swapConstraints.maxSwapTotalAccounts,
    },
    providers: swapEngineProvidersFromOpts(swapOpts),
  });

  const quoteResponse = engineResult.quoteResponse;
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

  const luts = [...(addressLookupTableAccounts ?? []), ...engineResult.swapLuts];

  const allNonFlIxs = [
    ...cuRequestIxs,
    ...borrowIxs.instructions,
    ...engineResult.swapInstructions,
    ...repayIxs.instructions,
  ];

  compileFlashloanPrecheck({
    allIxs: allNonFlIxs,
    payer: marginfiAccount.authority,
    luts,
    sizeConstraint: swapConstraints.sizeConstraint,
    swapIxCount: engineResult.swapInstructions.length,
    swapLutCount: engineResult.swapLuts.length,
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
    throw TransactionBuildingError.swapSizeExceededPositionSwap(
      txSize,
      totalKeys,
      swapOpts.swapConfig?.provider
    );
  }

  return {
    flashloanTx,
    setupInstructions: engineResult.setupInstructions,
    swapQuote: quoteResponse,
    borrowIxs,
    repayIxs,
  };
}

// ----------------------------------------------------------------------------
// Bridged (double-hop) fallback
// ----------------------------------------------------------------------------

export interface MakeBridgedSwapDebtTxParams extends MakeSwapDebtTxParams {
  bridgeOpts?: BridgeOpts;
}

/**
 * {@link makeSwapDebtTx} with a transparent bridged fallback: if the direct debt swap `A → C`
 * (repay A by borrowing C) can't fit one tx or has no route, decompose it into `A → bridge` +
 * `bridge → C` through a borrowable bridge debt, as one atomic bundle. The first leg repays A by
 * borrowing the bridge; the second leg repays exactly the bridge the first leg borrowed and
 * borrows C.
 */
export async function makeBridgedSwapDebtTx(
  params: MakeBridgedSwapDebtTxParams
): Promise<BridgedTxResult> {
  const { bridgeOpts, ...directParams } = params;
  try {
    return await makeSwapDebtTx(directParams);
  } catch (directError) {
    if (!isDecomposableSwapError(directError)) throw directError;
    // A pinned route (swapOpts.swapIxs) belongs to the direct pair and cannot be spliced into
    // SDK-composed legs — never attempt the bridged fallback with one.
    if (directParams.swapOpts.swapIxs) throw directError;
    const bridged = await tryBridgedDebtSwap(directParams, bridgeOpts);
    if (bridged) return bridged;
    throw directError;
  }
}

async function tryBridgedDebtSwap(
  params: MakeSwapDebtTxParams,
  bridgeOpts: BridgeOpts | undefined
): Promise<BridgedTxResult | null> {
  const sourceBank = params.repayOpts.repayBank;
  const destinationBank = params.borrowOpts.borrowBank;
  const repayAmount = params.repayOpts.repayAmount ?? params.repayOpts.totalPositionAmount;
  // Bridge legs price via the oracle (0 when missing): caller-supplied market prices only cover
  // the source/destination pair, never the bridge.
  const oraclePriceOf = (bank: BankType) =>
    params.oraclePrices.get(bank.address.toBase58())?.priceRealtime.price.toNumber() ?? 0;
  // A debt swap BORROWS the bridge → skip any candidate the account is supplying.
  const { usableBridgeBanks, conflictingBridgeBanks } = selectSwapBridges({
    sourceMint: sourceBank.mint,
    destinationMint: destinationBank.mint,
    bankMap: params.bankMap,
    marginfiAccount: params.marginfiAccount,
    bridgeTokenSide: "borrow",
    bridgeCandidateMints: bridgeOpts?.bridgeCandidateMints,
  });

  const tokenProgramCache = new Map(bridgeOpts?.tokenProgramByMint);
  return tryBridgeCandidates({
    usableBridgeBanks,
    conflictingBridgeBanks,
    bridgeTokenSide: "borrow",
    abortSignal: bridgeOpts?.abortSignal,
    buildBundleThroughBridge: async (bridgeBank) => {
      const bridgeTokenProgram = await resolveTokenProgramForMint(
        bridgeBank.mint,
        params.connection,
        tokenProgramCache
      );

      // First leg: repay A by borrowing the bridge (debt A → bridge).
      const firstLeg = await makeSwapDebtTx({
        ...sharedBridgeLegContext(params),
        repayOpts: {
          totalPositionAmount: params.repayOpts.totalPositionAmount,
          repayAmount,
          repayBank: sourceBank,
          tokenProgram: params.repayOpts.tokenProgram,
          marketPrice: oraclePriceOf(sourceBank),
        },
        borrowOpts: {
          borrowBank: bridgeBank,
          tokenProgram: bridgeTokenProgram,
          marketPrice: oraclePriceOf(bridgeBank),
        },
      });
      if (!firstLeg.quoteResponse) return null;

      // The first leg borrowed `inAmount` of the bridge (its swap input). The second leg repays
      // exactly that bridge debt — exact, so no slippage residual; repay-all clears it (no
      // partial-leftover deposit conflict).
      const bridgeBorrowedUi = nativeToUi(firstLeg.quoteResponse.inAmount, bridgeBank.mintDecimals);
      if (bridgeBorrowedUi <= 0) return null;

      const result = await composeBridgedSwap({
        firstLeg,
        buildSecondLeg: (projectedAccount) =>
          makeSwapDebtTx({
            ...sharedBridgeLegContext(params),
            marginfiAccount: projectedAccount,
            repayOpts: {
              totalPositionAmount: bridgeBorrowedUi,
              repayAmount: bridgeBorrowedUi,
              repayBank: bridgeBank,
              tokenProgram: bridgeTokenProgram,
              marketPrice: oraclePriceOf(bridgeBank),
            },
            borrowOpts: {
              borrowBank: destinationBank,
              tokenProgram: params.borrowOpts.tokenProgram,
              marketPrice: oraclePriceOf(destinationBank),
            },
          }),
        marginfiAccount: params.marginfiAccount,
        program: params.program,
        banksMap: params.bankMap,
        assetShareValueMultiplierByBank: params.assetShareValueMultiplierByBank,
        feePayer: params.overrideInferAccounts?.authority ?? params.marginfiAccount.authority,
        maxBundleTxs: bridgeOpts?.maxBundleTxs,
      });
      if (!result) return null;

      return {
        transactions: result.transactions,
        actionTxIndex: result.transactions.length - 1,
        quoteResponse: mergeBridgeQuotesDebt(result.firstLegQuote, result.secondLegQuote),
        bridgeMint: bridgeBank.mint,
        mustBeAtomicBundle: true,
      };
    },
  });
}
