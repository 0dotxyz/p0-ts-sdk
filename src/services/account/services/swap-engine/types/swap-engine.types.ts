import type {
  Address,
  AddressesByLookupTableAddress,
  GetAccountInfoApi,
  GetMultipleAccountsApi,
  Instruction,
  Rpc,
} from "@solana/kit";

import {
  SwapApiConfig,
  SwapProvider,
  SwapProviderEntry,
  SwapQuoteResult,
} from "~/services/account/types";

/**
 * The footprint of everything in the flashloan transaction *except* the swap.
 * Drives both the Titan V3 `transactionTemplate` (precise route sizing) and the
 * fit check / Jupiter account budget. `instructions` are the non-swap inner ixs
 * (CU + primary + secondary), with NO begin/end-flashloan wrapper — the wrapper
 * is optional context for Titan template accuracy only.
 */
export interface TxFootprint {
  instructions: Instruction[];
  luts: AddressesByLookupTableAddress;
  /** Begin/end-flashloan ixs, for Titan template sizing only (optional). */
  wrapperInstructions?: Instruction[];
  payer: Address;
  /** Available swap byte budget (net of the flashloan wrapper). */
  sizeConstraint: number;
  /** Available swap account-slot budget (net of the flashloan wrapper). */
  maxSwapTotalAccounts: number;
}

/** Provider-agnostic swap request handed to the engine. */
export interface SwapEngineRequest {
  inputMint: string;
  outputMint: string;
  /** ExactIn input amount in native (base) units. */
  amountNative: number;
  inputDecimals: number;
  outputDecimals: number;

  slippageBps?: number;
  slippageMode?: "DYNAMIC" | "FIXED";
  platformFeeBps?: number;
  directRoutesOnly?: boolean;

  taker: Address;
  destinationTokenAccount: Address;
  rpc: Rpc<GetAccountInfoApi & GetMultipleAccountsApi>;

  /** Required for the build path; ignored by the ExactOut estimate path. */
  footprint?: TxFootprint;

  /** Ordered providers to query (each with its own apiConfig). */
  providers: SwapProviderEntry[];
  /** Optional override for the Jupiter maxAccounts ladder. */
  jupiterMaxAccountsLadder?: number[];
}

/** A single route returned by a provider adapter, before the engine fit check. */
export interface ProviderSwapRoute {
  provider: SwapProvider;
  swapInstructions: Instruction[];
  setupInstructions: Instruction[];
  luts: AddressesByLookupTableAddress;
  /** Expected output (ExactIn) in native units. */
  outAmountNative: bigint;
  /** Minimum guaranteed output after slippage, in native units. */
  otherAmountThresholdNative: bigint;
  quoteResult: SwapQuoteResult;
  /** Optional label for diagnostics (e.g. Jupiter maxAccounts rung). */
  label?: string;
}

/** A provider route annotated with the engine's fit verdict. */
export interface SwapCandidate extends ProviderSwapRoute {
  fullTxSize: number;
  totalAccounts: number;
  fits: boolean;
}

/** Engine output — the exact shape the flashloan finalize step consumes. */
export interface SwapEngineResult {
  swapInstructions: Instruction[];
  setupInstructions: Instruction[];
  swapLuts: AddressesByLookupTableAddress;
  quoteResponse: SwapQuoteResult;
  outputAmountNative: bigint;
  /** Winning provider, for diagnostics. */
  provider: SwapProvider;
}

/**
 * Pluggable engine executor. Defaults to the in-process `runSwapEngine`; the app
 * injects a runner that forwards to the server-side `/api/tx/swap-engine` so the
 * provider fan-out happens once, server-side (Design B).
 */
export type SwapEngineRunner = (req: SwapEngineRequest) => Promise<SwapEngineResult>;

/**
 * A provider implementation. Add a provider = add an adapter + register it.
 *
 * Note: there is intentionally no ExactOut capability here. Provider ExactOut
 * quotes are unreliable and Jupiter Router `/build` is ExactIn-only, so callers
 * that need a target output (e.g. swap-debt) size the input from a market-price
 * calculation and route ExactIn instead.
 */
export interface SwapAdapter {
  name: SwapProvider;
  supportsBuild: boolean;
  /** Fetch one or more candidate routes (Jupiter returns several rungs). */
  buildCandidates(req: SwapEngineRequest, apiConfig?: SwapApiConfig): Promise<ProviderSwapRoute[]>;
}
