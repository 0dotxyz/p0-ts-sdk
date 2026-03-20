import {
  createJupiterApiClient,
  QuoteResponse,
  ConfigurationParameters,
  SwapApi,
  Configuration,
} from "@jup-ag/api";

import { Connection, PublicKey } from "@solana/web3.js";

import { SwapApiConfig, SwapIxsResult, SwapOpts, SwapProvider, SwapQuoteResult } from "../types";
import { getJupiterSwapIxsForFlashloan, toJupiterConfig } from "./jupiter.utils";
import { getTitanSwapIxsForFlashloan, getTitanExactOutEstimate } from "./titan.utils";

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

  const provider = swapOpts.swapConfig?.provider ?? SwapProvider.JUPITER;

  switch (provider) {
    case SwapProvider.TITAN:
      return getTitanSwapIxsForFlashloan({
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
        apiConfig: swapOpts.swapConfig?.apiConfig,
        sizeConstraint,
      });

    case SwapProvider.JUPITER:
    default:
      return getJupiterSwapIxsForFlashloan({
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
        apiConfig: swapOpts.swapConfig?.apiConfig,
        maxSwapAccounts,
      });
  }
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

  switch (provider) {
    case SwapProvider.TITAN:
      return getTitanExactOutEstimate({
        inputMint,
        outputMint,
        amount,
        slippageBps: swapOpts.swapConfig?.slippageBps,
        apiConfig: swapOpts.swapConfig?.apiConfig,
      });

    case SwapProvider.JUPITER:
    default: {
      const configParams = toJupiterConfig(swapOpts.swapConfig?.apiConfig);
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

      return {
        otherAmountThreshold: quoteResult.otherAmountThreshold,
        quoteResult,
      };
    }
  }
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
