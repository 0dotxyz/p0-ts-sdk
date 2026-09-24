import type { AddressesByLookupTableAddress, Instruction } from "@solana/kit";

import { SwapOpts, SwapQuoteResult } from "../types";

/** The canonical shape a resolved pinned route yields — mirrors an engine-selected route. */
export interface ResolvedPinnedSwapRoute {
  swapInstructions: Instruction[];
  setupInstructions: Instruction[];
  lookupTables: AddressesByLookupTableAddress;
  quoteResponse: SwapQuoteResult;
  /** The route's guaranteed min-out (native) — what sizes the follow-up amount (deposit patch). */
  outputAmountNative: bigint;
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
  expectedInAmountNative: bigint | number
): ResolvedPinnedSwapRoute {
  const { quoteResponse } = swapIxs;
  const expectedIn = BigInt(expectedInAmountNative);

  let minOut: bigint;
  try {
    minOut = BigInt(quoteResponse.otherAmountThreshold);
  } catch {
    minOut = 0n;
  }
  if (minOut <= 0n) {
    throw new Error(
      `Pinned swap route (swapOpts.swapIxs) has no usable min-out: quoteResponse.otherAmountThreshold ` +
        `is "${quoteResponse.otherAmountThreshold}". The min-out sizes the follow-up amount (e.g. the ` +
        `loop's deposit) — without it the flow would deposit zero collateral and fail init health.`
    );
  }

  const pinnedIn = BigInt(quoteResponse.inAmount);
  if (pinnedIn !== expectedIn) {
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
