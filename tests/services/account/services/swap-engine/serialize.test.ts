import { describe, it, expect } from "vitest";
import { AccountRole, getAddressDecoder, type Instruction } from "@solana/kit";

import { SwapProvider } from "~/services/account/types";
import {
  serializeSwapEngineRequest,
  deserializeSwapEngineRequest,
  serializeSwapEngineResult,
  deserializeSwapEngineResult,
} from "~/services/account/services/swap-engine/utils/serialize.utils";
import type {
  SwapEngineRequest,
  SwapEngineResult,
} from "~/services/account/services/swap-engine/types";

const uniqueAddress = () => getAddressDecoder().decode(crypto.getRandomValues(new Uint8Array(32)));

const ix = (): Instruction => ({
  programAddress: uniqueAddress(),
  accounts: [
    { address: uniqueAddress(), role: AccountRole.WRITABLE },
    { address: uniqueAddress(), role: AccountRole.READONLY_SIGNER },
  ],
  data: new Uint8Array([1, 2, 3, 4, 5]),
});

const dummyRpc = {} as SwapEngineRequest["rpc"];

describe("swap engine request serialization", () => {
  const taker = uniqueAddress();
  const dest = uniqueAddress();
  const payer = uniqueAddress();
  const footprintIx = ix();
  const lutAddress = uniqueAddress();
  const lutEntries = [uniqueAddress(), uniqueAddress()];

  const req: SwapEngineRequest = {
    inputMint: uniqueAddress(),
    outputMint: uniqueAddress(),
    amountNative: 123456,
    inputDecimals: 6,
    outputDecimals: 9,
    slippageBps: 50,
    slippageMode: "DYNAMIC",
    platformFeeBps: 10,
    directRoutesOnly: false,
    taker,
    destinationTokenAccount: dest,
    rpc: dummyRpc,
    footprint: {
      instructions: [footprintIx],
      luts: { [lutAddress]: lutEntries },
      payer,
      sizeConstraint: 800,
      maxSwapTotalAccounts: 30,
    },
    providers: [{ provider: SwapProvider.TITAN, apiConfig: { basePath: "x", apiKey: "secret" } }],
  };

  it("drops the rpc and per-provider apiConfig (keeps provider names)", () => {
    const s = serializeSwapEngineRequest(req);
    expect(s).not.toHaveProperty("rpc");
    expect(s.providers).toEqual([SwapProvider.TITAN]);
    expect(JSON.stringify(s)).not.toContain("secret");
  });

  it("round-trips the footprint ixs/luts and re-attaches server-side rpc + apiConfig", () => {
    const s = serializeSwapEngineRequest(req);
    const back = deserializeSwapEngineRequest(JSON.parse(JSON.stringify(s)), {
      rpc: dummyRpc,
      providerApiConfigs: { [SwapProvider.TITAN]: { basePath: "gateway", apiKey: "server-key" } },
    });

    expect(back.amountNative).toBe(req.amountNative);
    expect(back.taker).toBe(taker);
    expect(back.destinationTokenAccount).toBe(dest);
    expect(back.footprint?.payer).toBe(payer);
    expect(back.footprint?.sizeConstraint).toBe(800);
    expect(back.footprint?.instructions).toEqual([footprintIx]);
    expect(back.footprint?.luts).toEqual({ [lutAddress]: lutEntries });
    expect(back.rpc).toBe(dummyRpc);
    expect(back.providers[0].apiConfig?.apiKey).toBe("server-key");
  });
});

describe("swap engine result serialization", () => {
  it("round-trips instructions, luts, quote and the bigint output amount", () => {
    const result: SwapEngineResult = {
      swapInstructions: [ix()],
      setupInstructions: [ix()],
      swapLuts: { [uniqueAddress()]: [uniqueAddress(), uniqueAddress()] },
      quoteResponse: {
        inAmount: "1000",
        outAmount: "2000",
        otherAmountThreshold: "1990",
        slippageBps: 50,
        provider: SwapProvider.JUPITER,
      },
      outputAmountNative: 1990n,
      provider: SwapProvider.JUPITER,
    };

    const back = deserializeSwapEngineResult(
      JSON.parse(JSON.stringify(serializeSwapEngineResult(result)))
    );

    expect(back).toEqual(result);
  });
});
