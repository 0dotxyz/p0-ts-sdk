import { describe, it, expect } from "vitest";
import { Keypair, TransactionInstruction } from "@solana/web3.js";
import BN from "bn.js";

import { resolvePinnedSwapRoute } from "~/services/account/utils/swap.utils";
import type { SwapOpts, SwapQuoteResult } from "~/services/account";

function quote(o: Partial<SwapQuoteResult>): SwapQuoteResult {
  return {
    inAmount: "0",
    outAmount: "0",
    otherAmountThreshold: "0",
    slippageBps: 0,
    ...o,
  } as SwapQuoteResult;
}

function pinned(quoteResponse: SwapQuoteResult): NonNullable<SwapOpts["swapIxs"]> {
  return {
    instructions: [
      new TransactionInstruction({
        programId: Keypair.generate().publicKey,
        keys: [],
        data: Buffer.from([1, 2, 3]),
      }),
    ],
    lookupTables: [],
    quoteResponse,
  };
}

describe("resolvePinnedSwapRoute", () => {
  it("passes the pinned route through with min-out as the follow-up amount", () => {
    const q = quote({ inAmount: "1000000", outAmount: "995000", otherAmountThreshold: "990000" });
    const swapIxs = pinned(q);
    const resolved = resolvePinnedSwapRoute(swapIxs, new BN(1000000));

    // The deposit byte-patch amount is the GUARANTEED min-out — not the expected out.
    expect(resolved.outputAmountNative.toString()).toBe("990000");
    expect(resolved.quoteResponse).toBe(q);
    expect(resolved.swapInstructions).toBe(swapIxs.instructions);
    expect(resolved.setupInstructions).toEqual([]);
  });

  it("accepts a plain-number expected input amount", () => {
    const resolved = resolvePinnedSwapRoute(
      pinned(quote({ inAmount: "500", otherAmountThreshold: "7" })),
      500
    );
    expect(resolved.outputAmountNative.toString()).toBe("7");
  });

  it("throws when min-out is zero (the old silent zero-collateral deposit)", () => {
    expect(() =>
      resolvePinnedSwapRoute(
        pinned(quote({ inAmount: "1000000", otherAmountThreshold: "0" })),
        new BN(1000000)
      )
    ).toThrow(/no usable min-out/);
  });

  it("throws when min-out is unparseable", () => {
    expect(() =>
      resolvePinnedSwapRoute(
        pinned(quote({ inAmount: "1000000", otherAmountThreshold: "not-a-number" })),
        new BN(1000000)
      )
    ).toThrow(/no usable min-out/);
  });

  it("throws when the quote was sized for a different input than the flow will swap", () => {
    expect(() =>
      resolvePinnedSwapRoute(
        pinned(quote({ inAmount: "900000", otherAmountThreshold: "890000" })),
        new BN(1000000)
      )
    ).toThrow(/inAmount=900000.*swap input=1000000/);
  });
});
