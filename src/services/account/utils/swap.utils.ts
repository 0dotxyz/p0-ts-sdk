import {
  createJupiterApiClient,
  QuoteResponse,
  ConfigurationParameters,
  SwapApi,
  Configuration,
} from "@jup-ag/api";

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

// --- Generic fallback runner ---

async function runWithFallback<T>(
  attempts: SwapProviderEntry[],
  dispatch: Partial<Record<SwapProvider, (apiConfig?: SwapApiConfig) => Promise<T>>>,
  label: string
): Promise<T> {
  let firstError: unknown;

  for (const { provider, apiConfig } of attempts) {
    const fn = dispatch[provider];
    if (!fn) continue;

    try {
      return await fn(apiConfig);
    } catch (err) {
      if (!firstError) firstError = err;
      console.warn(`[${label}] ${provider} failed:`, err instanceof Error ? err.message : err);
    }
  }

  throw firstError ?? new Error(`No swap providers available`);
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
  maxSwapAccounts?: number;
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
    maxSwapAccounts,
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

  const dispatch: Partial<
    Record<SwapProvider, (apiConfig?: SwapApiConfig) => Promise<SwapIxsResult>>
  > = {
    [SwapProvider.TITAN]: (apiConfig) =>
      getTitanSwapIxsForFlashloan({
        inputMint,
        outputMint,
        amount,
        swapMode,
        slippageBps: swapOpts.swapConfig?.slippageBps,
        platformFeeBps: swapOpts.swapConfig?.platformFeeBps,
        directRoutesOnly: swapOpts.swapConfig?.directRoutesOnly,
        authority,
        connection,
        destinationTokenAccount,
        apiConfig,
        sizeConstraint,
        maxSwapAccounts,
        maxSwapTotalAccounts: params.maxSwapTotalAccounts,
      }),
    [SwapProvider.JUPITER]: (apiConfig) =>
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
        maxSwapAccounts,
      }),
  };

  const provider = swapOpts.swapConfig?.provider ?? SwapProvider.JUPITER;
  const attempts: SwapProviderEntry[] = [
    { provider, apiConfig: swapOpts.swapConfig?.apiConfig },
    ...(swapOpts.swapConfig?.fallbackProviders ?? []),
  ];

  return runWithFallback(attempts, dispatch, "swap");
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

  const dispatch: Partial<
    Record<SwapProvider, (apiConfig?: SwapApiConfig) => Promise<ExactOutEstimateResult>>
  > = {
    [SwapProvider.TITAN]: (apiConfig) =>
      getTitanExactOutEstimate({
        inputMint,
        outputMint,
        amount,
        slippageBps: swapOpts.swapConfig?.slippageBps,
        apiConfig,
      }),
    [SwapProvider.JUPITER]: async (apiConfig) => {
      const configParams = toJupiterConfig(apiConfig);
      const jupiterApiClient = configParams?.basePath
        ? new SwapApi(new Configuration(configParams))
        : createJupiterApiClient(configParams);

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
    },
  };

  const provider = swapOpts.swapConfig?.provider ?? SwapProvider.JUPITER;
  const attempts: SwapProviderEntry[] = [
    { provider, apiConfig: swapOpts.swapConfig?.apiConfig },
    ...(swapOpts.swapConfig?.fallbackProviders ?? []),
  ];

  return runWithFallback(attempts, dispatch, "exactout");
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
  };
}
