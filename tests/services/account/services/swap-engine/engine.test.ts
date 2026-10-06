import { address, createNoopSigner, getAddressDecoder, Instruction } from "@solana/kit";
import { getTransferSolInstruction } from "@solana-program/system";
import {
  findAssociatedTokenPda,
  getCloseAccountInstruction,
  getSyncNativeInstruction,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";
import { describe, it, expect, vi, beforeEach } from "vitest";

import type {
  ProviderSwapRoute,
  SwapEngineRequest,
} from "~/services/account/services/swap-engine/types";
import { WSOL_MINT } from "~/constants";
import { SwapProvider } from "~/services/account/types";

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
    return {
      fullTxSize: bytes,
      overshoot: bytes - FIT_THRESHOLD,
      writableAccounts: 5,
      totalAccounts: 10,
    };
  },
}));

vi.mock("~/services/account/services/swap-engine/adapters/registry", () => ({
  getSwapAdapter: (provider: string) => {
    const routes = store.routes.get(provider);
    if (!routes) return undefined;
    return { name: provider, supportsBuild: true, buildCandidates: async () => routes };
  },
}));

const DEFAULT = getAddressDecoder().decode(new Uint8Array(32));

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
    swapInstructions: [{ programAddress: DEFAULT, accounts: [], data: new Uint8Array(sizeBytes) }],
    setupInstructions: [],
    luts: {},
    outAmountNative: BigInt(outAmount),
    otherAmountThresholdNative: BigInt(threshold),
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

// The ixs Titan's raw routes (and Jupiter with wrapAndUnwrapSol=true) put around a SOL swap:
// fund the taker's wSOL ATA from lamports, sync it, swap, close it back to lamports.
const TAKER = address("GDDMwNyyx8uB6zrqwBFHjLLG3TBYk2F8Az4yrQC5RzMp");
const OTHER_ATA = address("BPFLoaderUpgradeab1e11111111111111111111111");
const SWAP_PROGRAM = address("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4");
const [TAKER_WSOL_ATA] = await findAssociatedTokenPda({
  owner: TAKER,
  mint: WSOL_MINT,
  tokenProgram: TOKEN_PROGRAM_ADDRESS,
});
const takerSigner = createNoopSigner(TAKER);
const wrapTransferIx = getTransferSolInstruction({
  source: takerSigner,
  destination: TAKER_WSOL_ATA,
  amount: 5,
});
const syncNativeIx = getSyncNativeInstruction({ account: TAKER_WSOL_ATA });
const closeWsolIx = getCloseAccountInstruction({
  account: TAKER_WSOL_ATA,
  destination: TAKER,
  owner: takerSigner,
});
const swapIx: Instruction = {
  programAddress: SWAP_PROGRAM,
  accounts: [],
  data: new Uint8Array([1, 2]),
};

function makeRequest(): SwapEngineRequest {
  return {
    inputMint: DEFAULT,
    outputMint: DEFAULT,
    amountNative: 1000,
    inputDecimals: 6,
    outputDecimals: 6,
    taker: DEFAULT,
    destinationTokenAccount: DEFAULT,
    rpc: {} as SwapEngineRequest["rpc"],
    footprint: {
      instructions: [],
      txFormat: { version: 0, luts: {} },
      payer: DEFAULT,
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
    expect(result.outputAmountNative).toBe(BigInt(Math.floor(1200 * 0.99)));
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
    expect(result.outputAmountNative).toBe(BigInt(Math.floor(1300 * 0.99)));
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

  it("drops provider SOL wrap/unwrap ixs around the swap so our flows own wSOL handling", async () => {
    const route = makeRoute(SwapProvider.TITAN, 1000, 10, "titan-raw");
    route.swapInstructions = [wrapTransferIx, syncNativeIx, swapIx, closeWsolIx];
    route.setupInstructions = [wrapTransferIx, syncNativeIx];
    store.routes.set(SwapProvider.TITAN, [route]);
    store.routes.set(SwapProvider.JUPITER, []);

    const result = await runSwapEngine({ ...makeRequest(), taker: TAKER });

    expect(result.swapInstructions).toEqual([swapIx]);
    expect(result.setupInstructions).toEqual([]);
  });

  it("keeps system/token ixs that are not the taker's wSOL wrap or unwrap", async () => {
    const transferElsewhere = getTransferSolInstruction({
      source: takerSigner,
      destination: OTHER_ATA,
      amount: 5,
    });
    const syncOther = getSyncNativeInstruction({ account: OTHER_ATA });
    const closeOther = getCloseAccountInstruction({
      account: OTHER_ATA,
      destination: TAKER,
      owner: takerSigner,
    });
    const route = makeRoute(SwapProvider.JUPITER, 1000, 10, "jup");
    route.swapInstructions = [transferElsewhere, syncOther, swapIx, closeOther];
    store.routes.set(SwapProvider.JUPITER, [route]);
    store.routes.set(SwapProvider.TITAN, []);

    const result = await runSwapEngine({ ...makeRequest(), taker: TAKER });

    expect(result.swapInstructions).toEqual([transferElsewhere, syncOther, swapIx, closeOther]);
  });
});
