import { describe, it, expect, vi, beforeEach } from "vitest";
import { Connection, PublicKey } from "@solana/web3.js";

import { SwapProvider } from "~/services/account/types";
import type { SwapEngineRequest } from "~/services/account/services/swap-engine/types";

// Capture the request the adapter sends over the WebSocket, and let each test
// stage the SwapQuotes the mocked stream yields.
const hoisted = vi.hoisted(() => ({
  request: undefined as unknown,
  quotes: undefined as unknown,
  closed: false,
  stoppedStreamId: undefined as number | undefined,
}));

// Mock only the WebSocket client; keep the real template builder, route
// selection, deserializer, and quote-result helper.
vi.mock("~/vendor/titan", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/vendor/titan")>();
  class MockV1Client {
    closed = false;
    static async connect(_url: string) {
      hoisted.closed = false;
      return new MockV1Client();
    }
    async newSwapQuoteStream(request: unknown) {
      hoisted.request = request;
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(hoisted.quotes);
        },
      });
      return { response: { intervalMs: 1000 }, stream, streamId: 7 };
    }
    async stopStream(id: number) {
      hoisted.stoppedStreamId = id;
      return { id };
    }
    async close() {
      this.closed = true;
      hoisted.closed = true;
    }
  }
  return { ...actual, V1Client: MockV1Client };
});

import { titanAdapter } from "~/services/account/services/swap-engine/adapters/titan.adapter";

function route(outAmount: number) {
  return {
    inAmount: 1_000,
    outAmount,
    slippageBps: 50,
    steps: [],
    instructions: [],
    addressLookupTables: [], // empty → resolveLookupTables makes no RPC call
  };
}

// Wire-format route whose swap instruction carries a `jitodontfront…` MEV-guard
// account (last, read-only) alongside a normal account. Mirrors the shape the
// Titan V3 router returns over the WebSocket.
const GUARD = "jitodontfronttitanspzero1111111111111111111";
// An arbitrary non-marker account that must survive the filter (control).
const NORMAL_ACCOUNT = PublicKey.unique().toBase58();
function routeWithGuard(outAmount: number) {
  return {
    inAmount: 1_000,
    outAmount,
    slippageBps: 50,
    steps: [],
    instructions: [
      {
        p: new PublicKey("T1TANpTeScyeqVzzgNViGDNrkQ6qHz9KrSBS4aNXvGT").toBytes(),
        a: [
          { p: new PublicKey(NORMAL_ACCOUNT).toBytes(), s: false, w: true },
          { p: new PublicKey(GUARD).toBytes(), s: false, w: false },
        ],
        d: new Uint8Array([1, 2, 3]),
      },
    ],
    addressLookupTables: [],
  };
}

function makeRequest(): SwapEngineRequest {
  return {
    inputMint: PublicKey.default.toBase58(),
    outputMint: PublicKey.default.toBase58(),
    amountNative: 1_000,
    inputDecimals: 6,
    outputDecimals: 6,
    taker: PublicKey.default,
    destinationTokenAccount: PublicKey.default,
    connection: {} as unknown as Connection,
    footprint: {
      instructions: [],
      luts: [],
      payer: PublicKey.default,
      sizeConstraint: 800,
      maxSwapTotalAccounts: 40,
    },
    providers: [{ provider: SwapProvider.TITAN }],
  };
}

const apiConfig = { wsUrl: "wss://host/api/v1/ws", apiKey: "jwt-token" };

describe("titan WS adapter", () => {
  beforeEach(() => {
    hoisted.request = undefined;
    hoisted.quotes = undefined;
    hoisted.closed = false;
    hoisted.stoppedStreamId = undefined;
  });

  it("sends a V3 request with the inline footprint template and provider allowlist", async () => {
    hoisted.quotes = { quotes: { Titan: route(100) }, metadata: { ExpectedWinner: "Titan" } };

    await titanAdapter.buildCandidates(makeRequest(), apiConfig);

    const req = hoisted.request as {
      swap: { swapMode: string; providers: string[]; transactionTemplate: unknown };
      transaction: { titanSwapVersion: number; outputWsol: boolean };
    };
    expect(req.swap.swapMode).toBe("ExactIn");
    expect(req.swap.providers).toEqual(["Titan", "Metis", "Okx"]);
    expect(req.transaction.titanSwapVersion).toBe(3);
    // Keep wSOL output wrapped so a following marginfi ix (built with
    // wrapAndUnwrapSol: false) can consume it from the destination ATA.
    expect(req.transaction.outputWsol).toBe(true);
    // The template is sent as a native object (i/a/m), not a base64 string.
    expect(typeof req.swap.transactionTemplate).toBe("object");
    expect(req.swap.transactionTemplate).toHaveProperty("i");
    expect(req.swap.transactionTemplate).toHaveProperty("a");
  });

  it("honors metadata.ExpectedWinner over raw outAmount", async () => {
    // Metis quotes a higher output, but Titan is the recommended winner.
    hoisted.quotes = {
      quotes: { Titan: route(100), Metis: route(200) },
      metadata: { ExpectedWinner: "Titan" },
    };

    const [candidate] = await titanAdapter.buildCandidates(makeRequest(), apiConfig);

    expect(candidate.provider).toBe(SwapProvider.TITAN);
    expect(candidate.outAmountNative.toString()).toBe("100");
  });

  it("falls back to best viable route and skips zero-output routes when no winner is named", async () => {
    hoisted.quotes = {
      quotes: { "Titan-DART": route(0), Metis: route(150) },
    };

    const [candidate] = await titanAdapter.buildCandidates(makeRequest(), apiConfig);

    expect(candidate.outAmountNative.toString()).toBe("150");
  });

  it("closes the connection (and stops the stream) after quoting", async () => {
    hoisted.quotes = { quotes: { Titan: route(100) }, metadata: { ExpectedWinner: "Titan" } };

    await titanAdapter.buildCandidates(makeRequest(), apiConfig);

    expect(hoisted.stoppedStreamId).toBe(7);
    expect(hoisted.closed).toBe(true);
  });

  it("strips Titan's jitodontfront MEV-guard account from swap instructions", async () => {
    hoisted.quotes = {
      quotes: { Titan: routeWithGuard(100) },
      metadata: { ExpectedWinner: "Titan" },
    };

    const [candidate] = await titanAdapter.buildCandidates(makeRequest(), apiConfig);

    const keys = candidate.swapInstructions.flatMap((ix) =>
      ix.keys.map((k) => k.pubkey.toBase58())
    );
    expect(keys).not.toContain(GUARD);
    // Non-marker accounts are preserved.
    expect(keys).toContain(NORMAL_ACCOUNT);
  });

  it("throws when no viable route is returned", async () => {
    hoisted.quotes = { quotes: { "Titan-DART": route(0) } };

    await expect(titanAdapter.buildCandidates(makeRequest(), apiConfig)).rejects.toThrow();
  });
});
