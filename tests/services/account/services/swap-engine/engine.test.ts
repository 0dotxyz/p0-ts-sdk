import { describe, it, expect, vi, beforeEach } from "vitest";
import { Connection, PublicKey } from "@solana/web3.js";
import BN from "bn.js";

import { SwapProvider } from "~/services/account/types";
import type {
  ProviderSwapRoute,
  SwapEngineRequest,
} from "~/services/account/services/swap-engine/types";

// Shared store the mocked registry reads from. `vi.hoisted` runs before the
// mock factory so the reference is available when `vi.mock` is hoisted.
const store = vi.hoisted(() => ({
  routes: new Map<string, ProviderSwapRoute[]>(),
}));

// Mock the precheck so "fits" is decided purely by the candidate's swap-ix byte
// size: a route fits when its total ix bytes are <= FIT_THRESHOLD.
const FIT_THRESHOLD = 100;
vi.mock("~/services/account/utils/flashloan-size.utils", () => ({
  compileFlashloanPrecheck: ({ allIxs }: { allIxs: { data: Uint8Array }[] }) => {
    const bytes = allIxs.reduce((n, ix) => n + ix.data.length, 0);
    return { fullTxSize: bytes, overshoot: bytes - FIT_THRESHOLD, writableAccounts: 5, totalAccounts: 10 };
  },
}));

vi.mock("~/services/account/services/swap-engine/adapters/registry", () => ({
  getSwapAdapter: (provider: string) => {
    const routes = store.routes.get(provider);
    if (!routes) return undefined;
    return { name: provider, supportsBuild: true, buildCandidates: async () => routes };
  },
}));

// Imported after the mocks are declared.
import { runSwapEngine } from "~/services/account/services/swap-engine/swap-engine.service";

function makeRoute(
  provider: SwapProvider,
  outAmount: number,
  sizeBytes: number,
  label?: string
): ProviderSwapRoute {
  const threshold = Math.floor(outAmount * 0.99);
  return {
    provider,
    swapInstructions: [
      { programId: PublicKey.default, keys: [], data: Buffer.alloc(sizeBytes) } as any,
    ],
    setupInstructions: [],
    luts: [],
    outAmountNative: new BN(outAmount),
    otherAmountThresholdNative: new BN(threshold),
    quoteResult: {
      inAmount: "0",
      outAmount: String(outAmount),
      otherAmountThreshold: String(threshold),
      slippageBps: 50,
      provider,
    },
    label,
  };
}

function makeRequest(): SwapEngineRequest {
  return {
    inputMint: PublicKey.default.toBase58(),
    outputMint: PublicKey.default.toBase58(),
    amountNative: 1000,
    inputDecimals: 6,
    outputDecimals: 6,
    taker: PublicKey.default,
    destinationTokenAccount: PublicKey.default,
    connection: {} as unknown as Connection,
    footprint: {
      instructions: [],
      luts: [],
      payer: PublicKey.default,
      sizeConstraint: 1000,
      maxSwapTotalAccounts: 50,
    },
    providers: [{ provider: SwapProvider.TITAN }, { provider: SwapProvider.JUPITER }],
  };
}

describe("runSwapEngine selection", () => {
  beforeEach(() => {
    store.routes.clear();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("picks the highest expected output among fitting routes", async () => {
    store.routes.set(SwapProvider.TITAN, [makeRoute(SwapProvider.TITAN, 1000, 20, "titan")]);
    store.routes.set(SwapProvider.JUPITER, [makeRoute(SwapProvider.JUPITER, 1200, 20, "jup")]);

    const result = await runSwapEngine(makeRequest());

    expect(result.provider).toBe(SwapProvider.JUPITER);
    // returns the minimum guaranteed output (otherAmountThreshold), not outAmount
    expect(result.outputAmountNative.eq(new BN(Math.floor(1200 * 0.99)))).toBe(true);
  });

  it("ignores a higher-output route that does not fit, choosing the best that does", async () => {
    // Titan has the better price but its ix is too big to fit.
    store.routes.set(SwapProvider.TITAN, [makeRoute(SwapProvider.TITAN, 5000, 500, "titan-big")]);
    store.routes.set(SwapProvider.JUPITER, [makeRoute(SwapProvider.JUPITER, 1100, 20, "jup-fits")]);

    const result = await runSwapEngine(makeRequest());

    expect(result.provider).toBe(SwapProvider.JUPITER);
  });

  it("considers multiple rungs from one provider and picks the best fitting", async () => {
    store.routes.set(SwapProvider.JUPITER, [
      makeRoute(SwapProvider.JUPITER, 5000, 500, "rung-big-best-price"), // doesn't fit
      makeRoute(SwapProvider.JUPITER, 1300, 30, "rung-mid"), // fits
      makeRoute(SwapProvider.JUPITER, 1200, 20, "rung-small"), // fits, worse price
    ]);
    store.routes.set(SwapProvider.TITAN, []);

    const result = await runSwapEngine(makeRequest());
    expect(result.outputAmountNative.eq(new BN(Math.floor(1300 * 0.99)))).toBe(true);
  });

  it("throws when no route fits", async () => {
    store.routes.set(SwapProvider.TITAN, [makeRoute(SwapProvider.TITAN, 5000, 500)]);
    store.routes.set(SwapProvider.JUPITER, [makeRoute(SwapProvider.JUPITER, 4000, 800)]);

    await expect(runSwapEngine(makeRequest())).rejects.toThrow();
  });

  it("throws when no provider returns a route", async () => {
    store.routes.set(SwapProvider.TITAN, []);
    store.routes.set(SwapProvider.JUPITER, []);
    await expect(runSwapEngine(makeRequest())).rejects.toThrow();
  });

  it("survives one provider returning nothing and selects from the other", async () => {
    store.routes.set(SwapProvider.JUPITER, [makeRoute(SwapProvider.JUPITER, 900, 20, "jup")]);
    store.routes.set(SwapProvider.TITAN, []);

    const result = await runSwapEngine(makeRequest());
    expect(result.provider).toBe(SwapProvider.JUPITER);
  });

  it("ignores a fitting route that yields zero output", async () => {
    // A degenerate provider route (instructions present, outAmount 0) must never win.
    store.routes.set(SwapProvider.TITAN, [makeRoute(SwapProvider.TITAN, 0, 20, "titan-zero")]);
    store.routes.set(SwapProvider.JUPITER, [makeRoute(SwapProvider.JUPITER, 1000, 20, "jup")]);

    const result = await runSwapEngine(makeRequest());
    expect(result.provider).toBe(SwapProvider.JUPITER);
  });

  it("throws when the only fitting route yields zero output", async () => {
    store.routes.set(SwapProvider.TITAN, [makeRoute(SwapProvider.TITAN, 0, 20, "titan-zero")]);
    store.routes.set(SwapProvider.JUPITER, []);

    await expect(runSwapEngine(makeRequest())).rejects.toThrow();
  });
});
