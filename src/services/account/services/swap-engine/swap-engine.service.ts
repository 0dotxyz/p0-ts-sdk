import { getU32Decoder, Instruction } from "@solana/kit";
import { SYSTEM_PROGRAM_ADDRESS, SystemInstruction } from "@solana-program/system";
import {
  findAssociatedTokenPda,
  TOKEN_PROGRAM_ADDRESS,
  TokenInstruction,
} from "@solana-program/token";

import { getSwapAdapter } from "./adapters";
import {
  ProviderSwapRoute,
  SwapAdapter,
  SwapCandidate,
  SwapEngineRequest,
  SwapEngineResult,
} from "./types";

import { MAX_ACCOUNT_LOCKS, WSOL_MINT } from "~/constants";
import { TransactionBuildingError } from "~/errors";
import { SwapApiConfig } from "~/services/account/types";
import { compileFlashloanPrecheck } from "~/services/account/utils/flashloan-size.utils";
import { withLookupTables } from "~/services/transaction";

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
      const message =
        result.reason instanceof Error ? result.reason.message : String(result.reason);
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

  // Our flows own SOL wrapping: the wSOL ATA is funded in-tx (borrow / withdraw / explicit wrap)
  // and its output is consumed by a following ix. A provider that wraps the input from the
  // taker's lamports (transfer + SyncNative) or unwraps the output (CloseAccount) — Titan's raw
  // routes do the former, Titan has no input-side `outputWsol` analog — would double-wrap or
  // break the consumer, so those ixs are dropped from every route.
  const [wsolAta] = await findAssociatedTokenPda({
    owner: req.taker,
    mint: WSOL_MINT,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
  });
  const isProviderSolWrapIx = (ix: Instruction) =>
    (ix.programAddress === SYSTEM_PROGRAM_ADDRESS &&
      ix.data !== undefined &&
      ix.data.length >= 12 &&
      getU32Decoder().decode(ix.data) === SystemInstruction.TransferSol &&
      ix.accounts?.[0]?.address === req.taker &&
      ix.accounts?.[1]?.address === wsolAta) ||
    (ix.programAddress === TOKEN_PROGRAM_ADDRESS &&
      (ix.data?.[0] === TokenInstruction.SyncNative ||
        ix.data?.[0] === TokenInstruction.CloseAccount) &&
      ix.accounts?.[0]?.address === wsolAta);

  const candidates = routes.map((route) =>
    annotateFit(
      {
        ...route,
        swapInstructions: route.swapInstructions.filter((ix) => !isProviderSolWrapIx(ix)),
        setupInstructions: route.setupInstructions.filter((ix) => !isProviderSolWrapIx(ix)),
      },
      req
    )
  );
  // A route must both fit the budget AND actually yield output — providers can
  // occasionally return a degenerate route (instructions present, outAmount 0);
  // selecting one would patch the deposit to ~0 and produce a broken tx.
  const fitting = candidates.filter((c) => c.fits && c.outAmountNative > 0n);

  if (fitting.length === 0) {
    // Report the closest-to-fitting candidate for diagnostics.
    const closest = candidates.reduce((best, c) => (c.fullTxSize < best.fullTxSize ? c : best));
    throw TransactionBuildingError.swapSizeExceededLoop(
      closest.fullTxSize,
      closest.totalAccounts,
      closest.provider
    );
  }

  // Highest expected output wins (ExactIn, same output token across providers).
  const winner = fitting.reduce((best, c) => (c.outAmountNative > best.outAmountNative ? c : best));

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

  const precheck = compileFlashloanPrecheck({
    allIxs,
    payer: footprint.payer,
    txFormat: withLookupTables(footprint.txFormat, route.luts),
    sizeConstraint: footprint.sizeConstraint,
    swapIxCount: route.swapInstructions.length,
    swapLutCount: Object.keys(route.luts).length,
  });

  const fits = precheck.overshoot <= 0 && precheck.totalAccounts <= MAX_ACCOUNT_LOCKS;

  return {
    ...route,
    fullTxSize: precheck.fullTxSize,
    totalAccounts: precheck.totalAccounts,
    fits,
  };
}
