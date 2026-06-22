import { SwapOpts, SwapProvider, SwapProviderEntry } from "~/services/account/types";

/**
 * Map a `SwapOpts` (primary provider + fallbacks) to the engine's provider list.
 * The engine queries ALL of them in parallel and picks the best fitting route,
 * so "fallback" providers become co-equal candidates here.
 */
export function swapEngineProvidersFromOpts(swapOpts: SwapOpts): SwapProviderEntry[] {
  const cfg = swapOpts.swapConfig;
  if (!cfg) return [{ provider: SwapProvider.JUPITER }];
  const entries: SwapProviderEntry[] = [{ provider: cfg.provider, apiConfig: cfg.apiConfig }];
  for (const fb of cfg.fallbackProviders ?? []) {
    if (!entries.some((e) => e.provider === fb.provider)) entries.push(fb);
  }
  return entries;
}

/** Slippage / fee fields pulled from a `SwapOpts` for an engine request. */
export function swapEngineQuoteFieldsFromOpts(swapOpts: SwapOpts): {
  slippageBps?: number;
  slippageMode?: "DYNAMIC" | "FIXED";
  platformFeeBps?: number;
  directRoutesOnly?: boolean;
} {
  const cfg = swapOpts.swapConfig;
  return {
    slippageBps: cfg?.slippageBps,
    slippageMode: cfg?.slippageMode,
    platformFeeBps: cfg?.platformFeeBps,
    directRoutesOnly: cfg?.directRoutesOnly,
  };
}
