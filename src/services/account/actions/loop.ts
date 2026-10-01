import {
  getTransactionMessageSizeLimit,
  type AddressesByLookupTableAddress,
  type BlockhashLifetimeConstraint,
  type Instruction,
} from "@solana/kit";
import {
  COMPUTE_BUDGET_PROGRAM_ADDRESS,
  getSetComputeUnitLimitInstruction,
  getSetComputeUnitPriceInstruction,
} from "@solana-program/compute-budget";
import { ASSOCIATED_TOKEN_PROGRAM_ADDRESS, findAssociatedTokenPda } from "@solana-program/token";
import { BigNumber } from "bignumber.js";

import {
  runSwapEngine,
  swapEngineProvidersFromOpts,
  swapEngineQuoteFieldsFromOpts,
} from "../services/swap-engine";
import { LoopFlashloanDescriptor, MakeLoopTxParams, SwapQuoteResult } from "../types";
import {
  computeFlashloanSwapConstraints,
  compileFlashloanPrecheck,
  patchDepositAmount,
  isDepositIx,
  BridgeOpts,
  BridgedTxResult,
  resolvePinnedSwapRoute,
  resolveTokenProgramForMint,
  selectSwapBridges,
  sharedBridgeLegContext,
  tryBridgeCandidates,
} from "../utils";

import { makeSetupIx } from "./account-lifecycle";
import { makeBorrowIx } from "./borrow";
import { composeBridgedSwap, mergeBridgeQuotesLoop } from "./bridge-swap";
import { makeDepositIx } from "./deposit";
import { makeFlashLoanTx } from "./flash-loan";
import { makeSwapDebtTx } from "./swap-debt";

import { MAX_ACCOUNT_LOCKS, WSOL_MINT } from "~/constants";
import { isDecomposableSwapError, TransactionBuildingError } from "~/errors";
import { BankType } from "~/services/bank";
import { makeRefreshIntegrationBanksIxs, OraclePrice } from "~/services/price";
import {
  getTotalAccountKeys,
  getTxSize,
  makeWrapSolIxs,
  SolanaTransaction,
  splitInstructionsToFitTransactions,
  TransactionType,
} from "~/services/transaction";
import { uiToNative } from "~/utils";

export async function makeLoopTx(params: MakeLoopTxParams): Promise<{
  transactions: SolanaTransaction[];
  actionTxIndex: number;
  quoteResponse: SwapQuoteResult | undefined;
  /** true → send as ONE atomic Jito bundle (integration refreshes go stale within a slot);
   *  false → sequential sends are safe (cranked oracles allow ≥ ~1 min staleness). */
  mustBeAtomicBundle: boolean;
}> {
  const { authority, depositOpts, borrowOpts, luts, version, rpc, additionalIxs = [] } = params;

  const { value: latestBlockhash } = await rpc
    .getLatestBlockhash({ commitment: "confirmed" })
    .send();

  // Setup Ata's if needed for borrow & deposit tokens
  const setupIxs = await makeSetupIx({
    rpc,
    authority,
    tokens: [
      {
        mint: borrowOpts.borrowBank.mint,
        tokenProgram: borrowOpts.tokenProgram,
      },
      {
        mint: depositOpts.depositBank.mint,
        tokenProgram: depositOpts.tokenProgram,
      },
    ],
  });

  // depositBank is excluded from the jup/drift updates (deposit ix updates them via CPI);
  // kamino has no cpi so borrow and deposit banks are included in the refresh
  const refreshIntegrationIxs = await makeRefreshIntegrationBanksIxs(
    params.marginfiAccount,
    params.bankMap,
    [depositOpts.depositBank.address],
    params.bankMetadataMap,
    [borrowOpts.borrowBank.address, depositOpts.depositBank.address]
  );

  const { flashloanTx, setupInstructions, swapQuote } = await buildLoopFlashloanTx({
    ...params,
    latestBlockhash,
  });

  // Add ata creations needed for routing
  const jupiterSetupInstructions = setupInstructions.filter((ix) => {
    // filter out compute budget instructions
    if (ix.programAddress === COMPUTE_BUDGET_PROGRAM_ADDRESS) {
      return false;
    }

    if (ix.programAddress === ASSOCIATED_TOKEN_PROGRAM_ADDRESS) {
      // key 3 is always mint in create ata
      const mintKey = ix.accounts?.[3]?.address;

      if (mintKey === depositOpts.depositBank.mint || mintKey === borrowOpts.borrowBank.mint) {
        return false;
      }
    }

    return true;
  });

  setupIxs.push(...jupiterSetupInstructions);

  const additionalTxs: SolanaTransaction[] = [];

  // wrap sol if needed
  if (depositOpts.depositBank.mint === WSOL_MINT && depositOpts.inputDepositAmount) {
    setupIxs.push(
      ...(await makeWrapSolIxs(authority, new BigNumber(depositOpts.inputDepositAmount)))
    );
  }

  // if atas are needed, add them
  if (setupIxs.length > 0 || additionalIxs.length > 0 || refreshIntegrationIxs.length > 0) {
    const ixs = [...additionalIxs, ...setupIxs, ...refreshIntegrationIxs];
    const messages = splitInstructionsToFitTransactions([], ixs, {
      latestBlockhash,
      feePayer: authority,
      luts: luts ?? {},
      version,
    });

    additionalTxs.push(
      ...messages.map((message) => ({ message, type: TransactionType.CREATE_ATA }))
    );
  }

  const transactions = [...additionalTxs, flashloanTx];
  return {
    transactions,
    actionTxIndex: transactions.length - 1,
    quoteResponse: swapQuote,
    mustBeAtomicBundle: refreshIntegrationIxs.length > 0,
  };
}

type LoopParams = MakeLoopTxParams & { latestBlockhash: BlockhashLifetimeConstraint };

/**
 * Orchestrates the deferred-swap loop build:
 *   1. buildLoopNonSwapIxs  — everything except the swap, deposit seeded with a market-price estimate
 *   2. swap engine          — picks a route against the remaining budget (interim adapter for now)
 *   3. finalizeLoopFlashloanTx — splice swap, byte-patch deposit amount, wrap + validate
 */
async function buildLoopFlashloanTx(params: LoopParams) {
  const { depositOpts } = params;

  const { descriptor, swapNeeded, borrowIxs, depositIxs } = await buildLoopNonSwapIxs(params);

  // No swap: deposit amount is already exact, nothing to insert or patch.
  if (!swapNeeded) {
    const flashloanTx = await finalizeLoopFlashloanTx({
      params,
      innerIxs: descriptor.innerIxs,
      luts: descriptor.luts,
      swapIxCount: 0,
      swapLutCount: 0,
      sizeConstraint: descriptor.sizeConstraint,
    });

    return {
      flashloanTx,
      setupInstructions: [] as Instruction[],
      swapQuote: undefined,
      borrowIxs,
      depositIxs,
    };
  }

  // Step 2: swap engine — picks the best-priced route that fits the remaining budget.
  const engineResult = await runLoopSwapEngine(descriptor, params);

  // Step 3: splice the swap ix(s) into the swap slot, then byte-patch the deposit amount
  // to the real swap output (plus the deposit principal in DEPOSIT mode).
  const finalIxs = [...descriptor.innerIxs];
  finalIxs.splice(descriptor.swapSlotIndex, 0, ...engineResult.swapInstructions);

  const principalNative =
    depositOpts.loopMode === "DEPOSIT"
      ? uiToNative(depositOpts.inputDepositAmount, depositOpts.depositBank.mintDecimals)
      : 0n;
  const finalDepositNative = engineResult.outputAmountNative + principalNative;

  const depositIxPosition = descriptor.depositIxIndex + engineResult.swapInstructions.length;
  finalIxs[depositIxPosition] = patchDepositAmount(finalIxs[depositIxPosition], finalDepositNative);

  const flashloanTx = await finalizeLoopFlashloanTx({
    params,
    innerIxs: finalIxs,
    luts: { ...descriptor.luts, ...engineResult.swapLuts },
    swapIxCount: engineResult.swapInstructions.length,
    swapLutCount: Object.keys(engineResult.swapLuts).length,
    sizeConstraint: descriptor.sizeConstraint,
  });

  return {
    flashloanTx,
    setupInstructions: engineResult.setupInstructions,
    swapQuote: engineResult.quoteResponse,
    borrowIxs,
    depositIxs,
  };
}

/**
 * Step 1: build the loop's inner instructions (compute budget, borrow, deposit) without the swap.
 * When a swap is required the deposit is seeded with a no-slippage market-price estimate of the
 * borrow amount; the real amount is patched in after the swap engine runs. Returns a descriptor
 * the engine uses to size its route against the remaining flashloan budget.
 */
async function buildLoopNonSwapIxs(params: LoopParams): Promise<{
  descriptor: LoopFlashloanDescriptor;
  swapNeeded: boolean;
  borrowIxs: Instruction[];
  depositIxs: Instruction[];
}> {
  const {
    programAddress,
    marginfiAccount,
    authority,
    bankMap,
    borrowOpts,
    depositOpts,
    bankMetadataMap,
    luts,
  } = params;

  const cuRequestIxs = [
    getSetComputeUnitLimitInstruction({ units: 1_200_000 }),
    getSetComputeUnitPriceInstruction({ microLamports: 1 }),
  ];

  const swapNeeded = depositOpts.depositBank.mint !== borrowOpts.borrowBank.mint;

  const [destinationTokenAccount] = await findAssociatedTokenPda({
    mint: depositOpts.depositBank.mint,
    owner: authority.address,
    tokenProgram: depositOpts.tokenProgram,
  });

  const principalUi = depositOpts.loopMode === "DEPOSIT" ? depositOpts.inputDepositAmount : 0;

  let depositAmountUi: number;
  let sizeConstraint = 0;
  let maxSwapTotalAccounts = 0;

  if (!swapNeeded) {
    // Same mint: borrow and deposit the same token, amount is exact.
    depositAmountUi = borrowOpts.borrowAmount + principalUi;
  } else {
    // Measure how many bytes & accounts remain for swapping (net of begin/end flashloan).
    const swapConstraints = await computeFlashloanSwapConstraints({
      programAddress,
      marginfiAccount,
      bankMap,
      bankMetadataMap,
      luts: luts ?? {},
      primaryIx: {
        type: "borrow",
        bank: borrowOpts.borrowBank,
        tokenProgram: borrowOpts.tokenProgram,
      },
      secondaryIx: {
        type: "deposit",
        bank: depositOpts.depositBank,
        tokenProgram: depositOpts.tokenProgram,
      },
    });
    sizeConstraint = swapConstraints.sizeConstraint;
    maxSwapTotalAccounts = swapConstraints.maxSwapTotalAccounts;

    // No-slippage market-price estimate of the swap output (patched to the real value post-swap).
    const estimateUi = (borrowOpts.borrowAmount * borrowOpts.marketPrice) / depositOpts.marketPrice;
    depositAmountUi = estimateUi + principalUi;
  }

  const borrowIxs = await makeBorrowIx({
    programAddress,
    bank: borrowOpts.borrowBank,
    bankMap,
    tokenProgram: borrowOpts.tokenProgram,
    amount: borrowOpts.borrowAmount,
    marginfiAccount,
    authority,
    opts: {
      createAtas: false,
      wrapAndUnwrapSol: false,
    },
  });

  const depositIxs = await makeDepositIx({
    programAddress,
    bank: depositOpts.depositBank,
    tokenProgram: depositOpts.tokenProgram,
    amount: depositAmountUi,
    marginfiAccount,
    authority,
    bankMetadataMap,
    opts: {
      wrapAndUnwrapSol: false,
    },
  });

  // Inner ix order: [cuRequest..., borrow..., <swap slot>, deposit...]
  const innerIxsBeforeSwap = [...cuRequestIxs, ...borrowIxs];
  const swapSlotIndex = innerIxsBeforeSwap.length;
  const innerIxs = [...innerIxsBeforeSwap, ...depositIxs];

  const depositIxIndex = innerIxs.findIndex(isDepositIx);
  if (depositIxIndex < 0) {
    throw new Error(
      "buildLoopNonSwapIxs: could not locate deposit instruction for amount patching"
    );
  }

  const descriptor: LoopFlashloanDescriptor = {
    innerIxs,
    swapSlotIndex,
    depositIxIndex,
    inputMint: borrowOpts.borrowBank.mint,
    outputMint: depositOpts.depositBank.mint,
    inputDecimals: borrowOpts.borrowBank.mintDecimals,
    outputDecimals: depositOpts.depositBank.mintDecimals,
    inAmountNative: Number(uiToNative(borrowOpts.borrowAmount, borrowOpts.borrowBank.mintDecimals)),
    destinationTokenAccount,
    sizeConstraint,
    maxSwapTotalAccounts,
    luts: luts ?? {},
  };

  return { descriptor, swapNeeded, borrowIxs, depositIxs };
}

/**
 * Step 2: run the multi-provider swap engine (ExactIn on the borrow amount) and adapt
 * the result to the loop's splice/patch contract. The descriptor's inner ixs + LUTs are
 * the footprint the engine sizes routes against (full-footprint Titan template + fit check).
 */
async function runLoopSwapEngine(
  descriptor: LoopFlashloanDescriptor,
  params: LoopParams
): Promise<{
  swapInstructions: Instruction[];
  setupInstructions: Instruction[];
  swapLuts: AddressesByLookupTableAddress;
  quoteResponse: SwapQuoteResult;
  outputAmountNative: bigint;
}> {
  const { rpc, swapOpts, authority, swapEngineRunner, version } = params;

  // Caller-pinned route override: the pinned quote's min-out sizes the deposit byte-patch,
  // exactly like an engine-selected route (validated — a pinned route can never silently
  // produce a zero-collateral deposit).
  if (swapOpts.swapIxs) {
    const pinned = resolvePinnedSwapRoute(swapOpts.swapIxs, descriptor.inAmountNative);
    return {
      swapInstructions: pinned.swapInstructions,
      setupInstructions: pinned.setupInstructions,
      swapLuts: pinned.lookupTables,
      quoteResponse: pinned.quoteResponse,
      outputAmountNative: pinned.outputAmountNative,
    };
  }

  const runEngine = swapEngineRunner ?? runSwapEngine;
  const engineResult = await runEngine({
    inputMint: descriptor.inputMint,
    outputMint: descriptor.outputMint,
    amountNative: descriptor.inAmountNative,
    inputDecimals: descriptor.inputDecimals,
    outputDecimals: descriptor.outputDecimals,
    ...swapEngineQuoteFieldsFromOpts(swapOpts),
    taker: authority.address,
    destinationTokenAccount: descriptor.destinationTokenAccount,
    rpc,
    footprint: {
      instructions: descriptor.innerIxs,
      luts: descriptor.luts,
      version,
      payer: authority.address,
      sizeConstraint: descriptor.sizeConstraint,
      maxSwapTotalAccounts: descriptor.maxSwapTotalAccounts,
    },
    providers: swapEngineProvidersFromOpts(swapOpts),
  });

  return {
    swapInstructions: engineResult.swapInstructions,
    setupInstructions: engineResult.setupInstructions,
    swapLuts: engineResult.swapLuts,
    quoteResponse: engineResult.quoteResponse,
    outputAmountNative: engineResult.outputAmountNative,
  };
}

/**
 * Step 3: wrap the assembled inner ixs in a flashloan and validate size/account budget.
 * The flashloan end index is recomputed from the final ix count inside makeFlashLoanTx, so it
 * is correct after swap insertion without any byte patching.
 */
async function finalizeLoopFlashloanTx({
  params,
  innerIxs,
  luts,
  swapIxCount,
  swapLutCount,
  sizeConstraint,
}: {
  params: LoopParams;
  innerIxs: Instruction[];
  luts: AddressesByLookupTableAddress;
  swapIxCount: number;
  swapLutCount: number;
  sizeConstraint: number;
}) {
  const {
    programAddress,
    marginfiAccount,
    authority,
    bankMap,
    swapOpts,
    latestBlockhash,
    version,
  } = params;

  if (swapIxCount > 0) {
    compileFlashloanPrecheck({
      allIxs: innerIxs,
      payer: authority.address,
      luts,
      sizeConstraint,
      swapIxCount,
      swapLutCount,
      version,
    });
  }

  // if cuRequestIxs are not present, priority fee ix is needed
  // wallets add a priority fee ix by default breaking the flashloan tx so we need to add a placeholder priority fee ix
  // docs: https://docs.phantom.app/developer-powertools/solana-priority-fees
  // Solflare requires you to also include the set compute unit price to avoid transaction rejection on flashloans.
  const flashloanTx = await makeFlashLoanTx({
    programAddress,
    marginfiAccount,
    authority,
    bankMap,
    luts,
    version,
    latestBlockhash,
    ixs: innerIxs,
  });

  const txSize = getTxSize(flashloanTx.message);
  const totalKeys = getTotalAccountKeys(flashloanTx.message);

  if (
    txSize > getTransactionMessageSizeLimit(flashloanTx.message) ||
    totalKeys > MAX_ACCOUNT_LOCKS
  ) {
    throw TransactionBuildingError.swapSizeExceededLoop(
      txSize,
      totalKeys,
      swapOpts.swapConfig?.provider
    );
  }

  return flashloanTx;
}

// ----------------------------------------------------------------------------
// Bridged (double-hop) fallback
// ----------------------------------------------------------------------------

export interface MakeBridgedLoopTxParams extends MakeLoopTxParams {
  bridgeOpts?: BridgeOpts;
  /** Prices the bridge legs (by bank address). */
  oraclePrices: Map<string, OraclePrice>;
}

/**
 * {@link makeLoopTx} with a transparent bridged fallback: if the direct loop's borrow→deposit swap
 * can't fit one tx or has no route, loop P borrowing a value-equivalent amount of a bridge token,
 * then debt-swap the bridge debt → X, as one atomic bundle.
 *
 * Intended for existing accounts — a fresh account's loop has a minimal footprint and fits the
 * direct path, so callers creating the account in the same flow should call {@link makeLoopTx}
 * directly.
 */
export async function makeBridgedLoopTx(params: MakeBridgedLoopTxParams): Promise<BridgedTxResult> {
  const { bridgeOpts, ...loopParams } = params;
  try {
    return await makeLoopTx(loopParams);
  } catch (directError) {
    if (!isDecomposableSwapError(directError)) throw directError;
    // A pinned route (swapOpts.swapIxs) belongs to the direct pair and cannot be spliced into
    // SDK-composed legs — never attempt the bridged fallback with one.
    if (loopParams.swapOpts.swapIxs) throw directError;
    const bridged = await tryBridgedLoop(loopParams, bridgeOpts);
    if (bridged) return bridged;
    throw directError;
  }
}

async function tryBridgedLoop(
  params: Omit<MakeBridgedLoopTxParams, "bridgeOpts">,
  bridgeOpts: BridgeOpts | undefined
): Promise<BridgedTxResult | null> {
  const { depositBank } = params.depositOpts;
  const { borrowBank } = params.borrowOpts;
  // A loop BORROWS the bridge → skip any candidate the account is supplying.
  const { usableBridgeBanks, conflictingBridgeBanks } = selectSwapBridges({
    sourceMint: depositBank.mint,
    destinationMint: borrowBank.mint,
    bankMap: params.bankMap,
    marginfiAccount: params.marginfiAccount,
    bridgeTokenSide: "borrow",
    bridgeCandidateMints: bridgeOpts?.bridgeCandidateMints,
  });

  // Bridge legs price via the oracle (0 when missing): caller-supplied market prices only cover
  // the source/destination pair, never the bridge.
  const oraclePriceOf = (bank: BankType) =>
    params.oraclePrices.get(bank.address)?.priceRealtime.price.toNumber() ?? 0;

  const borrowBankPrice = oraclePriceOf(borrowBank);
  if (borrowBankPrice <= 0) return null;

  const tokenProgramCache = new Map(bridgeOpts?.tokenProgramByMint);
  return tryBridgeCandidates({
    usableBridgeBanks,
    conflictingBridgeBanks,
    bridgeTokenSide: "borrow",
    abortSignal: bridgeOpts?.abortSignal,
    buildBundleThroughBridge: async (bridgeBank) => {
      const bridgeBankPrice = oraclePriceOf(bridgeBank);
      if (bridgeBankPrice <= 0) return null;

      // Borrow a value-equivalent amount of the bridge instead of X — same leverage / P deposit.
      const bridgeBorrowUi = (params.borrowOpts.borrowAmount * borrowBankPrice) / bridgeBankPrice;
      if (bridgeBorrowUi <= 0) return null;
      const bridgeTokenProgram = await resolveTokenProgramForMint(
        bridgeBank.mint,
        params.rpc,
        tokenProgramCache
      );

      // First leg: loop P borrowing the bridge (borrow bridge, swap bridge→P, deposit P).
      const firstLeg = await makeLoopTx({
        ...params,
        depositOpts: {
          ...params.depositOpts,
          marketPrice: oraclePriceOf(depositBank),
        },
        borrowOpts: {
          borrowAmount: bridgeBorrowUi,
          borrowBank: bridgeBank,
          tokenProgram: bridgeTokenProgram,
          marketPrice: bridgeBankPrice,
        },
      });
      if (!firstLeg.quoteResponse) return null;

      const result = await composeBridgedSwap({
        firstLeg,
        // Second leg: debt-swap the bridge debt → X (repay exactly the bridge the first leg
        // borrowed — exact, so no slippage residual; repay-all clears it — and borrow X).
        buildSecondLeg: (projectedAccount) =>
          makeSwapDebtTx({
            ...sharedBridgeLegContext(params),
            marginfiAccount: projectedAccount,
            repayOpts: {
              totalPositionAmount: bridgeBorrowUi,
              repayAmount: bridgeBorrowUi,
              repayBank: bridgeBank,
              tokenProgram: bridgeTokenProgram,
              marketPrice: bridgeBankPrice,
            },
            borrowOpts: {
              borrowBank,
              tokenProgram: params.borrowOpts.tokenProgram,
              marketPrice: borrowBankPrice,
            },
          }),
        marginfiAccount: params.marginfiAccount,
        programAddress: params.programAddress,
        banksMap: params.bankMap,
        assetShareValueMultiplierByBank: params.assetShareValueMultiplierByBank,
        feePayer: params.authority,
        maxBundleTxs: bridgeOpts?.maxBundleTxs,
      });
      if (!result) return null; // both legs didn't build / bundle didn't fit — try the next bridge

      return {
        transactions: result.transactions,
        actionTxIndex: result.transactions.length - 1,
        quoteResponse: mergeBridgeQuotesLoop(result.firstLegQuote, result.secondLegQuote),
        bridgeMint: bridgeBank.mint,
        mustBeAtomicBundle: true,
      };
    },
  });
}
