import { createJupiterClient, type QuoteResponse } from "~/vendor/jupiter";

import { Connection, PublicKey } from "@solana/web3.js";

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

  // Manual swap instructions override
  if (swapOpts.swapIxs) {
    return {
      swapInstructions: swapOpts.swapIxs.instructions,
      setupInstructions: [],
      addressLookupTableAddresses: swapOpts.swapIxs.lookupTables,
      quoteResponse: {
        inAmount: String(amount),
        outAmount: "0",
        otherAmountThreshold: "0",
        slippageBps: 0,
      },
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
