import {
  getTransactionMessageSizeLimit,
  type BlockhashLifetimeConstraint,
  type Instruction,
} from "@solana/kit";
import {
  getSetComputeUnitLimitInstruction,
  getSetComputeUnitPriceInstruction,
} from "@solana-program/compute-budget";
import { findAssociatedTokenPda } from "@solana-program/token";

import {
  computeBorrowEstimateForRepay,
  runSwapEngine,
  swapEngineProvidersFromOpts,
  swapEngineQuoteFieldsFromOpts,
} from "../services/swap-engine";
import { MakeSwapDebtTxParams, SwapFlowTxResult, SwapQuoteResult } from "../types";
import {
  isWholePosition,
  computeFlashloanSwapConstraints,
  compileFlashloanPrecheck,
  filterRouteSetupIxs,
} from "../utils";

import { makeCreateMissingAtaIxs } from "./account-lifecycle";
import { makeBorrowIx } from "./borrow";
import { BridgedTxResult, BridgeOpts, makeBridgedTx } from "./bridge-swap";
import { makeFlashLoanTx } from "./flash-loan";
import { makeRepayIx } from "./repay";

import { MAX_ACCOUNT_LOCKS } from "~/constants";
import { TransactionBuildingError } from "~/errors";
import { BankType } from "~/services/bank";
import { makeRefreshIntegrationBanksIxs, OraclePrice } from "~/services/price";
import {
  getTotalAccountKeys,
  getTxSize,
  makePreludeTxs,
  SolanaTransaction,
  withLookupTables,
} from "~/services/transaction";
import { nativeToUi, uiToNative } from "~/utils";

/**
 * Swaps one debt position into another in one flashloan: borrows the new debt, swaps it into the
 * old debt's token and repays `repayOpts`, without the account's health dipping in between. The
 * borrow is sized from the caller's market prices plus a slippage buffer. Prelude transactions
 * create missing ATAs and refresh integration banks.
 * @throws TransactionBuildingError (INVALID_AMOUNT) if `repayAmount` isn't positive
 * @throws TransactionBuildingError (SWAP_QUOTE_FAILED) if no provider can quote the swap
 * @throws TransactionBuildingError (SWAP_SIZE_EXCEEDED_POSITION_SWAP) if the flashloan doesn't fit
 * one transaction
 *
 * @example
 * const { transactions, actionTxIndex, quoteResponse } = await makeSwapDebtTx({
 *   programAddress,
 *   marginfiAccount,
 *   authority,
 *   rpc,
 *   bankMap,
 *   repayOpts: { totalPositionAmount: 100, repayBank: usdcBank, tokenProgram },
 *   borrowOpts: { borrowBank: solBank, tokenProgram },
 *   swapOpts: { swapConfig: { provider: SwapProvider.JUPITER, slippageMode: "DYNAMIC", slippageBps: 50, platformFeeBps: 0 } },
 *   // ...
 * });
 */
export async function makeSwapDebtTx(params: MakeSwapDebtTxParams): Promise<SwapFlowTxResult> {
  const {
    marginfiAccount,
    authority,
    rpc,
    bankMap,
    repayOpts,
    borrowOpts,
    bankMetadataMap,
    txFormat,
    additionalIxs = [],
  } = params;

  const { value: latestBlockhash } = await rpc
    .getLatestBlockhash({ commitment: "confirmed" })
    .send();

  const setupIxs = await makeCreateMissingAtaIxs({
    rpc,
    authority,
    tokens: [
      { mint: repayOpts.repayBank.mint, tokenProgram: repayOpts.tokenProgram },
      { mint: borrowOpts.borrowBank.mint, tokenProgram: borrowOpts.tokenProgram },
    ],
  });

  // No jup/drift exclusions here; kamino has no cpi so repay and borrow banks are
  // included in the refresh
  const refreshIntegrationIxs = await makeRefreshIntegrationBanksIxs(
    marginfiAccount,
    bankMap,
    [],
    bankMetadataMap,
    [repayOpts.repayBank.address, borrowOpts.borrowBank.address]
  );

  const { flashloanTx, setupInstructions, swapQuote } = await buildSwapDebtFlashloanTx({
    ...params,
    latestBlockhash,
  });

  setupIxs.push(
    ...filterRouteSetupIxs(setupInstructions, [
      repayOpts.repayBank.mint,
      borrowOpts.borrowBank.mint,
    ])
  );

  const additionalTxs = makePreludeTxs([...additionalIxs, ...setupIxs], refreshIntegrationIxs, {
    latestBlockhash,
    feePayer: authority,
    txFormat,
  });

  const transactions = [...additionalTxs, flashloanTx];

  return {
    transactions,
    actionTxIndex: transactions.length - 1,
    quoteResponse: swapQuote,
    mustBeAtomicBundle: refreshIntegrationIxs.length > 0,
  };
}

async function buildSwapDebtFlashloanTx({
  programAddress,
  marginfiAccount,
  authority,
  bankMap,
  repayOpts,
  borrowOpts,
  swapOpts,
  bankMetadataMap,
  txFormat,
  rpc,
  latestBlockhash,
  swapEngineRunner,
}: MakeSwapDebtTxParams & { latestBlockhash: BlockhashLifetimeConstraint }): Promise<{
  flashloanTx: SolanaTransaction;
  setupInstructions: Instruction[];
  swapQuote: SwapQuoteResult;
}> {
  const {
    repayBank,
    tokenProgram: repayTokenProgram,
    totalPositionAmount,
    repayAmount,
  } = repayOpts;
  const { borrowBank, tokenProgram: borrowTokenProgram } = borrowOpts;

  if (repayAmount !== undefined && repayAmount <= 0) {
    throw TransactionBuildingError.invalidAmount(repayAmount);
  }

  const actualRepayAmount = Math.min(repayAmount ?? totalPositionAmount, totalPositionAmount);

  const cuRequestIxs = [
    getSetComputeUnitLimitInstruction({ units: 1_200_000 }),
    getSetComputeUnitPriceInstruction({ microLamports: 1 }),
  ];

  const [destinationTokenAccount] = await findAssociatedTokenPda({
    mint: repayBank.mint,
    owner: authority.address,
    tokenProgram: repayTokenProgram,
  });

  // Sized from market prices, not a provider ExactOut quote: Jupiter's `/build` is ExactIn-only and
  // ExactOut routes are unreliable
  const estimatedBorrowAmount = computeBorrowEstimateForRepay({
    repayTargetUi: actualRepayAmount,
    repayMarketPrice: repayOpts.marketPrice,
    borrowMarketPrice: borrowOpts.marketPrice,
    slippageBps: swapOpts.swapConfig?.slippageBps,
    isRepayAll: actualRepayAmount >= totalPositionAmount,
  });

  const swapConstraints = await computeFlashloanSwapConstraints({
    programAddress,
    marginfiAccount,
    bankMap,
    bankMetadataMap,
    txFormat,
    primaryIx: { type: "borrow", bank: borrowBank, tokenProgram: borrowTokenProgram },
    secondaryIx: { type: "repay", bank: repayBank, tokenProgram: repayTokenProgram },
  });

  const borrowParams = {
    programAddress,
    bank: borrowBank,
    bankMap,
    tokenProgram: borrowTokenProgram,
    marginfiAccount,
    authority,
    opts: { createAta: false, unwrapSol: false },
  };
  const repayParams = {
    programAddress,
    bank: repayBank,
    tokenProgram: repayTokenProgram,
    marginfiAccount,
    authority,
    opts: { wrapSol: false },
  };

  // The route is sized against borrow and repay ixs at estimated amounts (their footprint doesn't
  // depend on the amount); the real ones are built from the winning quote
  const footprintBorrowIxs = await makeBorrowIx({ ...borrowParams, amount: estimatedBorrowAmount });
  const footprintRepayIxs = await makeRepayIx({ ...repayParams, amount: actualRepayAmount });

  const runEngine = swapEngineRunner ?? runSwapEngine;
  const engineResult = await runEngine({
    inputMint: borrowBank.mint,
    outputMint: repayBank.mint,
    amountNative: Number(uiToNative(estimatedBorrowAmount, borrowBank.mintDecimals)),
    inputDecimals: borrowBank.mintDecimals,
    outputDecimals: repayBank.mintDecimals,
    ...swapEngineQuoteFieldsFromOpts(swapOpts),
    taker: authority.address,
    destinationTokenAccount,
    rpc,
    footprint: {
      instructions: [...cuRequestIxs, ...footprintBorrowIxs, ...footprintRepayIxs],
      txFormat,
      payer: authority.address,
      sizeConstraint: swapConstraints.sizeConstraint,
      maxSwapTotalAccounts: swapConstraints.maxSwapTotalAccounts,
    },
    providers: swapEngineProvidersFromOpts(swapOpts),
  });

  const quoteResponse = engineResult.quoteResponse;
  const outAmount = nativeToUi(quoteResponse.outAmount, repayBank.mintDecimals);
  const outAmountThreshold = nativeToUi(quoteResponse.otherAmountThreshold, repayBank.mintDecimals);

  // An expected output above the debt repays all of it; otherwise repay the guaranteed minimum
  const amountToRepay = outAmount > totalPositionAmount ? totalPositionAmount : outAmountThreshold;

  // ExactIn: the quote's input is the borrow
  const borrowAmount = nativeToUi(quoteResponse.inAmount, borrowBank.mintDecimals);
  const borrowIxs = await makeBorrowIx({ ...borrowParams, amount: borrowAmount });
  const repayIxs = await makeRepayIx({
    ...repayParams,
    amount: amountToRepay,
    repayAll: isWholePosition(
      {
        amount: totalPositionAmount,
        isLending: false,
      },
      amountToRepay,
      repayBank.mintDecimals
    ),
  });

  const flashloanFormat = withLookupTables(txFormat, engineResult.swapLuts);

  const allNonFlIxs = [
    ...cuRequestIxs,
    ...borrowIxs,
    ...engineResult.swapInstructions,
    ...repayIxs,
  ];

  compileFlashloanPrecheck({
    allIxs: allNonFlIxs,
    payer: authority.address,
    txFormat: flashloanFormat,
    sizeConstraint: swapConstraints.sizeConstraint,
    swapIxCount: engineResult.swapInstructions.length,
    swapLutCount: Object.keys(engineResult.swapLuts).length,
  });

  const flashloanTx = await makeFlashLoanTx({
    programAddress,
    marginfiAccount,
    authority,
    bankMap,
    txFormat: flashloanFormat,
    latestBlockhash,
    ixs: allNonFlIxs,
  });

  const txSize = getTxSize(flashloanTx.message);
  const totalKeys = getTotalAccountKeys(flashloanTx.message);

  if (
    txSize > getTransactionMessageSizeLimit(flashloanTx.message) ||
    totalKeys > MAX_ACCOUNT_LOCKS
  ) {
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
  };
}

// ----------------------------------------------------------------------------
// Bridged (double-hop) fallback
// ----------------------------------------------------------------------------

export interface MakeBridgedSwapDebtTxParams extends MakeSwapDebtTxParams {
  bridgeOpts?: BridgeOpts;
  /** Prices the bridge legs (by bank address). */
  oraclePrices: Map<string, OraclePrice>;
}

/**
 * {@link makeSwapDebtTx}, or when the debt swap `A → C` (repay A by borrowing C) doesn't fit one
 * transaction or has no route, repays A by borrowing a bridge, then repays the bridge by borrowing
 * C, as one atomic bundle (see {@link makeBridgedTx}).
 */
export async function makeBridgedSwapDebtTx(
  params: MakeBridgedSwapDebtTxParams
): Promise<BridgedTxResult> {
  const { repayOpts, borrowOpts } = params;
  // The legs are priced by oracle (0 when missing): the caller's market prices only cover A and C
  const priceOf = (bank: BankType) =>
    params.oraclePrices.get(bank.address)?.priceRealtime.price.toNumber() ?? 0;
  return makeBridgedTx({
    ...params,
    side: "borrow",
    sourceMint: repayOpts.repayBank.mint,
    destinationMint: borrowOpts.borrowBank.mint,
    buildWithoutBridge: () => makeSwapDebtTx(params),
    buildOpenBridgeLeg: ({ bridgeBank, bridgeTokenProgram, context }) =>
      makeSwapDebtTx({
        ...context,
        repayOpts: { ...repayOpts, marketPrice: priceOf(repayOpts.repayBank) },
        borrowOpts: {
          borrowBank: bridgeBank,
          tokenProgram: bridgeTokenProgram,
          marketPrice: priceOf(bridgeBank),
        },
      }),
    buildCloseBridgeLeg: async ({ bridgeBank, bridgeTokenProgram, context, openLegQuote }) => {
      // Repay exactly the bridge the open leg borrowed (its swap input), so repay-all clears it
      const bridgeDebt = nativeToUi(openLegQuote.inAmount, bridgeBank.mintDecimals);
      if (bridgeDebt <= 0) return null;
      return makeSwapDebtTx({
        ...context,
        repayOpts: {
          totalPositionAmount: bridgeDebt,
          repayAmount: bridgeDebt,
          repayBank: bridgeBank,
          tokenProgram: bridgeTokenProgram,
          marketPrice: priceOf(bridgeBank),
        },
        borrowOpts: { ...borrowOpts, marketPrice: priceOf(borrowOpts.borrowBank) },
      });
    },
  });
}
