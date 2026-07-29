import { createJupiterClient, type QuoteResponse } from "~/vendor/jupiter";

import BN from "bn.js";
import { Connection, PublicKey, TransactionInstruction } from "@solana/web3.js";
import { AddressLookupTableAccount } from "@solana/web3.js";

import {
  SwapApiConfig,
  SwapIxsResult,
  SwapOpts,
  SwapProvider,
  SwapProviderEntry,
  SwapQuoteResult,
} from "../types";
import { getJupiterSwapIxsForFlashloan, toJupiterConfig } from "./jupiter.utils";
import { getTitanSwapIxsForFlashloan, getTitanExactOutEstimate } from "./titan.utils";
import { TransactionBuildingError } from "~/errors";

/** The canonical shape a resolved pinned route yields — mirrors an engine-selected route. */
export interface ResolvedPinnedSwapRoute {
  swapInstructions: TransactionInstruction[];
  setupInstructions: TransactionInstruction[];
  lookupTables: AddressLookupTableAccount[];
  quoteResponse: SwapQuoteResult;
  /** The route's guaranteed min-out (native) — what sizes the follow-up amount (deposit patch). */
  outputAmountNative: BN;
}

/**
 * Resolve a caller-pinned swap route (`swapOpts.swapIxs`) into the engine-result shape, validating
 * the quote so a pinned route can never silently size a zero follow-up amount:
 *
 * - `otherAmountThreshold` (min-out) must be a positive integer — it becomes the loop's deposit
 *   byte-patch, exactly like an engine-selected route's min-out.
 * - `inAmount` must equal the flow's swap input (e.g. the loop's borrow, native units) — a
 *   mismatch means the route was quoted for a different size than the flow will actually swap.
 *
 * Throws plain `Error`s (not `TransactionBuildingError`) so caller-input mistakes are never
 * classified as decomposable swap failures (which would wrongly engage the bridged fallback).
 */
export function resolvePinnedSwapRoute(
  swapIxs: NonNullable<SwapOpts["swapIxs"]>,
  expectedInAmountNative: BN | number
): ResolvedPinnedSwapRoute {
  const { quoteResponse } = swapIxs;
  const expectedIn = new BN(expectedInAmountNative);

  let minOut: BN;
  try {
    minOut = new BN(quoteResponse.otherAmountThreshold);
  } catch {
    minOut = new BN(0);
  }
  if (minOut.lten(0)) {
    throw new Error(
      `Pinned swap route (swapOpts.swapIxs) has no usable min-out: quoteResponse.otherAmountThreshold ` +
        `is "${quoteResponse.otherAmountThreshold}". The min-out sizes the follow-up amount (e.g. the ` +
        `loop's deposit) — without it the flow would deposit zero collateral and fail init health.`
    );
  }

  const pinnedIn = new BN(quoteResponse.inAmount);
  if (!pinnedIn.eq(expectedIn)) {
    throw new Error(
      `Pinned swap route (swapOpts.swapIxs) was quoted for a different input amount than the flow ` +
        `will swap: quote inAmount=${pinnedIn.toString()}, flow swap input=${expectedIn.toString()} ` +
        `(native units). Re-quote the pinned route for the exact flow amount.`
    );
  }

  return {
    swapInstructions: swapIxs.instructions,
    setupInstructions: [],
    lookupTables: swapIxs.lookupTables,
    quoteResponse,
    outputAmountNative: minOut,
  };
}

// Helper to get swap provider function
function getSwapProviderFn({
  attemptProvider,
  maxSwapTotalAccounts,
  inputMint,
  outputMint,
  amount,
  swapMode,
  authority,
  connection,
  destinationTokenAccount,
  swapOpts,
  sizeConstraint,
}: {
  attemptProvider: SwapProvider;
  maxSwapTotalAccounts?: number;
  inputMint: string;
  outputMint: string;
  amount: number;
  swapMode: "ExactIn" | "ExactOut";
  authority: PublicKey;
  connection: Connection;
  destinationTokenAccount: PublicKey;
  swapOpts: SwapOpts;
  sizeConstraint?: number;
}): ((apiConfig?: SwapApiConfig) => Promise<SwapIxsResult>) | undefined {
  switch (attemptProvider) {
    case SwapProvider.TITAN:
      return (apiConfig) =>
        getTitanSwapIxsForFlashloan({
          quoteParams: {
            inputMint,
            outputMint,
            amount,
            swapMode,
            slippageBps: swapOpts.swapConfig?.slippageBps,
            platformFeeBps: swapOpts.swapConfig?.platformFeeBps,
            directRoutesOnly: swapOpts.swapConfig?.directRoutesOnly,
            sizeConstraint,
            maxSwapTotalAccounts,
          },
          authority,
          connection,
          destinationTokenAccount,
          apiConfig,
        });
    case SwapProvider.JUPITER:
      return (apiConfig) =>
        getJupiterSwapIxsForFlashloan({
          quoteParams: {
            inputMint,
            outputMint,
            amount,
            swapMode,
            dynamicSlippage: swapOpts.swapConfig
              ? swapOpts.swapConfig.slippageMode === "DYNAMIC"
              : true,
            slippageBps: swapOpts.swapConfig?.slippageBps,
            platformFeeBps: swapOpts.swapConfig?.platformFeeBps,
            onlyDirectRoutes: swapOpts.swapConfig?.directRoutesOnly ?? false,
          },
          authority,
          connection,
          destinationTokenAccount,
          apiConfig,
          maxSwapAccounts: maxSwapTotalAccounts,
        });
    default:
      return undefined;
  }
}

// Helper to get exact out estimate provider function
function getExactOutProviderFn({
  attemptProvider,
  inputMint,
  outputMint,
  amount,
  swapOpts,
  apiConfig,
}: {
  attemptProvider: SwapProvider;
  inputMint: string;
  outputMint: string;
  amount: number;
  swapOpts: SwapOpts;
  apiConfig?: SwapApiConfig;
}): ((apiConfig?: SwapApiConfig) => Promise<ExactOutEstimateResult>) | undefined {
  switch (attemptProvider) {
    case SwapProvider.TITAN:
      return () =>
        getTitanExactOutEstimate({
          inputMint,
          outputMint,
          amount,
          slippageBps: swapOpts.swapConfig?.slippageBps,
          apiConfig,
        });
    case SwapProvider.JUPITER:
      return async () => {
        const jupiterApiClient = createJupiterClient(toJupiterConfig(apiConfig));

        const estimateQuote = await jupiterApiClient.quoteGet({
          inputMint,
          outputMint,
          amount,
          swapMode: "ExactOut",
          dynamicSlippage: swapOpts.swapConfig
            ? swapOpts.swapConfig.slippageMode === "DYNAMIC"
            : true,
          slippageBps: swapOpts.swapConfig?.slippageBps,
          // Match the bundle-compatible routing used by the executed flashloan
          // swap so the ExactOut estimate reflects an achievable route.
          forJitoBundle: true,
        });

        const quoteResult = mapJupiterQuoteToSwapQuoteResult(estimateQuote);
        return { otherAmountThreshold: quoteResult.otherAmountThreshold, quoteResult };
      };
    default:
      return undefined;
  }
}

// --- Provider router ---

export type GetSwapIxsForFlashloanParams = {
  inputMint: string;
  outputMint: string;
  amount: number;
  swapMode: "ExactIn" | "ExactOut";
  authority: PublicKey;
  connection: Connection;
  destinationTokenAccount: PublicKey;
  swapOpts: SwapOpts;
  sizeConstraint?: number;
  maxSwapTotalAccounts?: number;
};

export const getSwapIxsForFlashloan = async (
  params: GetSwapIxsForFlashloanParams
): Promise<SwapIxsResult> => {
  const {
    inputMint,
    outputMint,
    amount,
    swapMode,
    authority,
    connection,
    destinationTokenAccount,
    swapOpts,
    sizeConstraint,
    maxSwapTotalAccounts,
  } = params;

  // Caller-pinned route override — validated so it can never size a zero follow-up amount.
  if (swapOpts.swapIxs) {
    const pinned = resolvePinnedSwapRoute(swapOpts.swapIxs, amount);
    return {
      swapInstructions: pinned.swapInstructions,
      setupInstructions: pinned.setupInstructions,
      addressLookupTableAddresses: pinned.lookupTables,
      quoteResponse: pinned.quoteResponse,
    };
  }

  const provider = swapOpts.swapConfig?.provider ?? SwapProvider.JUPITER;
  const attempts: SwapProviderEntry[] = [
    { provider, apiConfig: swapOpts.swapConfig?.apiConfig },
    ...(swapOpts.swapConfig?.fallbackProviders ?? []),
  ];

  let lastError: unknown;

  for (const { provider: attemptProvider, apiConfig } of attempts) {
    const fn = getSwapProviderFn({
      attemptProvider,
      maxSwapTotalAccounts: params.maxSwapTotalAccounts,
      inputMint,
      outputMint,
      amount,
      swapMode,
      authority,
      connection,
      destinationTokenAccount,
      swapOpts,
      sizeConstraint,
    });

    if (!fn) continue;

    try {
      return await fn(apiConfig);
    } catch (err) {
      if (err instanceof TransactionBuildingError) throw err;
      lastError = err;
      console.warn(`[swap] ${attemptProvider} failed:`, err instanceof Error ? err.message : err);
    }
  }

  // All providers failed — throw typed error
  const firstProvider = attempts[0]?.provider ?? "Swap";
  throw TransactionBuildingError.swapQuoteFailed(
    firstProvider,
    inputMint,
    outputMint,
    (lastError as Error)?.message ?? "No swap route available"
  );
};

// --- ExactOut estimate router (used by swap-debt) ---

export type GetExactOutEstimateParams = {
  inputMint: string;
  outputMint: string;
  amount: number;
  swapOpts: SwapOpts;
  connection: Connection;
};

export type ExactOutEstimateResult = {
  otherAmountThreshold: string;
  quoteResult: SwapQuoteResult;
};

/**
 * @deprecated Do not use provider ExactOut quotes — they are unreliable and the
 * Jupiter Router (`/build`) is ExactIn-only. Size a target-output swap from a
 * market-price calculation and route ExactIn instead (see `makeSwapDebtTx`).
 */
export const getExactOutEstimate = async (
  params: GetExactOutEstimateParams
): Promise<ExactOutEstimateResult> => {
  const { inputMint, outputMint, amount, swapOpts, connection } = params;

  const provider = swapOpts.swapConfig?.provider ?? SwapProvider.JUPITER;
  const attempts: SwapProviderEntry[] = [
    { provider, apiConfig: swapOpts.swapConfig?.apiConfig },
    ...(swapOpts.swapConfig?.fallbackProviders ?? []),
  ];

  let lastError: unknown;

  for (const { provider: attemptProvider, apiConfig } of attempts) {
    const fn = getExactOutProviderFn({
      attemptProvider,
      inputMint,
      outputMint,
      amount,
      swapOpts,
      apiConfig,
    });

    if (!fn) continue;

    try {
      return await fn(apiConfig);
    } catch (err) {
      if (err instanceof TransactionBuildingError) throw err;
      lastError = err;
      console.warn(
        `[exactout] ${attemptProvider} failed:`,
        err instanceof Error ? err.message : err
      );
    }
  }

  // All providers failed — throw typed error
  const firstProvider = attempts[0]?.provider ?? "Swap";
  throw TransactionBuildingError.swapQuoteFailed(
    firstProvider,
    inputMint,
    outputMint,
    (lastError as Error)?.message ?? "No swap route available"
  );
};

// --- Jupiter QuoteResponse → SwapQuoteResult mapper ---

export function mapJupiterQuoteToSwapQuoteResult(quote: QuoteResponse): SwapQuoteResult {
  return {
    inAmount: quote.inAmount,
    outAmount: quote.outAmount,
    otherAmountThreshold: quote.otherAmountThreshold,
    slippageBps: quote.slippageBps,
    platformFee: quote.platformFee
      ? {
          amount: quote.platformFee.amount ?? "0",
          feeBps: quote.platformFee.feeBps ?? 0,
        }
      : undefined,
    priceImpactPct: quote.priceImpactPct,
    contextSlot: quote.contextSlot,
    timeTaken: quote.timeTaken,
    provider: SwapProvider.JUPITER,
  };
}
