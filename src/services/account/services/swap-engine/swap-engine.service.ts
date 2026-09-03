import { getSwapAdapter } from "./adapters";
import {
  ProviderSwapRoute,
  SwapAdapter,
  SwapCandidate,
  SwapEngineRequest,
  SwapEngineResult,
} from "./types";

import { MAX_ACCOUNT_LOCKS } from "~/constants";
import { TransactionBuildingError } from "~/errors";
import { SwapApiConfig, SwapProvider } from "~/services/account/types";
import { compileFlashloanPrecheck } from "~/services/account/utils/flashloan-size.utils";

interface ResolvedAdapter {
  adapter: SwapAdapter;
  apiConfig?: SwapApiConfig;
}

/** Resolve configured providers to adapters that satisfy `predicate`. */
function resolveAdapters(
  req: SwapEngineRequest,
  predicate: (adapter: SwapAdapter) => boolean
): ResolvedAdapter[] {
  const resolved: ResolvedAdapter[] = [];
  for (const entry of req.providers) {
    const adapter = getSwapAdapter(entry.provider);
    if (adapter && predicate(adapter)) {
      resolved.push({ adapter, apiConfig: entry.apiConfig });
    }
  }
  return resolved;
}

/**
 * Multi-provider swap engine. Fans out to every configured provider in parallel,
 * keeps only routes that fit the remaining flashloan budget, and returns the one
 * with the highest expected output (ExactIn). The returned shape matches the
 * flashloan finalize seam so callers splice + patch + wrap unchanged.
 */
export async function runSwapEngine(req: SwapEngineRequest): Promise<SwapEngineResult> {
  const adapters = resolveAdapters(req, (a) => a.supportsBuild);

  if (adapters.length === 0) {
    throw TransactionBuildingError.swapQuoteFailed(
      req.providers[0]?.provider ?? "Swap",
      req.inputMint,
      req.outputMint,
      "No build-capable swap provider configured"
    );
  }

  const settled = await Promise.allSettled(
    adapters.map(({ adapter, apiConfig }) => adapter.buildCandidates(req, apiConfig))
  );

  const routes: ProviderSwapRoute[] = [];
  const failures: string[] = [];
  for (const [i, result] of settled.entries()) {
    if (result.status === "fulfilled") {
      routes.push(...result.value);
    } else {
      const provider = adapters[i].adapter.name;
      const message = result.reason instanceof Error ? result.reason.message : String(result.reason);
      failures.push(`${provider}: ${message}`);
      console.warn(`[swap-engine] ${provider} failed:`, message);
    }
  }

  if (routes.length === 0) {
    throw TransactionBuildingError.swapQuoteFailed(
      req.providers[0]?.provider ?? "Swap",
      req.inputMint,
      req.outputMint,
      failures.join("; ") || "No swap route available"
    );
  }

  const candidates = routes.map((route) => annotateFit(route, req));
  // A route must both fit the budget AND actually yield output — providers can
  // occasionally return a degenerate route (instructions present, outAmount 0);
  // selecting one would patch the deposit to ~0 and produce a broken tx.
  const fitting = candidates.filter((c) => c.fits && c.outAmountNative.gtn(0));

  if (fitting.length === 0) {
    // Report the closest-to-fitting candidate for diagnostics.
    const closest = candidates.reduce((best, c) =>
      c.fullTxSize < best.fullTxSize ? c : best
    );
    throw TransactionBuildingError.swapSizeExceededLoop(
      closest.fullTxSize,
      closest.totalAccounts,
      closest.provider
    );
  }

  // Highest expected output wins (ExactIn, same output token across providers).
  const winner = fitting.reduce((best, c) =>
    c.outAmountNative.gt(best.outAmountNative) ? c : best
  );

  console.log("[swap-engine] selected", {
    provider: winner.provider,
    label: winner.label,
    outAmount: winner.outAmountNative.toString(),
    fullTxSize: winner.fullTxSize,
    totalAccounts: winner.totalAccounts,
    candidates: candidates.map((c) => ({
      provider: c.provider,
      label: c.label,
      out: c.outAmountNative.toString(),
      fits: c.fits,
      size: c.fullTxSize,
    })),
  });

  return {
    swapInstructions: winner.swapInstructions,
    setupInstructions: winner.setupInstructions,
    swapLuts: winner.luts,
    quoteResponse: winner.quoteResult,
    // Patch the deposit to the minimum guaranteed output so the tx can't fail
    // on a deposit larger than the swap actually yields.
    outputAmountNative: winner.otherAmountThresholdNative,
    provider: winner.provider,
  };
}

/** Compile the full inner tx (footprint + this route's swap) to verify it fits. */
function annotateFit(route: ProviderSwapRoute, req: SwapEngineRequest): SwapCandidate {
  const { footprint } = req;
  if (!footprint) throw new Error("runSwapEngine requires a footprint");
  const allIxs = [...footprint.instructions, ...route.swapInstructions];
  const luts = [...footprint.luts, ...route.luts];

  const precheck = compileFlashloanPrecheck({
    allIxs,
    payer: footprint.payer,
    luts,
    sizeConstraint: footprint.sizeConstraint,
    swapIxCount: route.swapInstructions.length,
    swapLutCount: route.luts.length,
  });

  const fits = precheck.overshoot <= 0 && precheck.totalAccounts <= MAX_ACCOUNT_LOCKS;

  return {
    ...route,
    fullTxSize: precheck.fullTxSize,
    totalAccounts: precheck.totalAccounts,
    fits,
  };
}

