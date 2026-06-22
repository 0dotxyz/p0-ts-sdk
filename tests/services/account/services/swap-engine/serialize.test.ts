import { describe, it, expect } from "vitest";
import {
  AddressLookupTableAccount,
  Connection,
  Keypair,
  PublicKey,
  TransactionInstruction,
} from "@solana/web3.js";
import BN from "bn.js";

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

const ix = () =>
  new TransactionInstruction({
    programId: Keypair.generate().publicKey,
    keys: [
      { pubkey: Keypair.generate().publicKey, isSigner: false, isWritable: true },
      { pubkey: Keypair.generate().publicKey, isSigner: true, isWritable: false },
    ],
    data: Buffer.from([1, 2, 3, 4, 5]),
  });

const lut = () =>
  new AddressLookupTableAccount({
    key: Keypair.generate().publicKey,
    state: {
      deactivationSlot: BigInt("18446744073709551615"),
      lastExtendedSlot: 0,
      lastExtendedSlotStartIndex: 0,
      addresses: [Keypair.generate().publicKey, Keypair.generate().publicKey],
    },
  });

const dummyConnection = {} as unknown as Connection;

describe("swap engine request serialization", () => {
  const taker = Keypair.generate().publicKey;
  const dest = Keypair.generate().publicKey;
  const payer = Keypair.generate().publicKey;
  const footprintIx = ix();
  const footprintLut = lut();

  const req: SwapEngineRequest = {
    inputMint: Keypair.generate().publicKey.toBase58(),
    outputMint: Keypair.generate().publicKey.toBase58(),
    amountNative: 123456,
    inputDecimals: 6,
    outputDecimals: 9,
    slippageBps: 50,
    slippageMode: "DYNAMIC",
    platformFeeBps: 10,
    directRoutesOnly: false,
    taker,
    destinationTokenAccount: dest,
    connection: dummyConnection,
    footprint: {
      instructions: [footprintIx],
      luts: [footprintLut],
      payer,
      sizeConstraint: 800,
      maxSwapTotalAccounts: 30,
    },
    providers: [{ provider: SwapProvider.TITAN, apiConfig: { basePath: "x", apiKey: "secret" } }],
  };

  it("drops connection and per-provider apiConfig (keeps provider names)", () => {
    const s = serializeSwapEngineRequest(req);
    expect(s).not.toHaveProperty("connection");
    expect(s.providers).toEqual([SwapProvider.TITAN]);
    expect(JSON.stringify(s)).not.toContain("secret");
  });

  it("round-trips the footprint ixs/luts and re-attaches server-side connection + apiConfig", () => {
    const s = serializeSwapEngineRequest(req);
    const back = deserializeSwapEngineRequest(s, {
      connection: dummyConnection,
      providerApiConfigs: { [SwapProvider.TITAN]: { basePath: "gateway", apiKey: "server-key" } },
    });

    expect(back.amountNative).toBe(req.amountNative);
    expect(back.taker.equals(taker)).toBe(true);
    expect(back.destinationTokenAccount.equals(dest)).toBe(true);
    expect(back.footprint?.payer.equals(payer)).toBe(true);
    expect(back.footprint?.sizeConstraint).toBe(800);

    // instruction preserved
    const rIx = back.footprint!.instructions[0];
    expect(rIx.programId.equals(footprintIx.programId)).toBe(true);
    expect(Buffer.from(rIx.data).equals(footprintIx.data)).toBe(true);
    expect(rIx.keys[0].pubkey.equals(footprintIx.keys[0].pubkey)).toBe(true);
    expect(rIx.keys[1].isSigner).toBe(true);

    // lut preserved
    const rLut = back.footprint!.luts[0];
    expect(rLut.key.equals(footprintLut.key)).toBe(true);
    expect(rLut.state.addresses[0].equals(footprintLut.state.addresses[0])).toBe(true);

    // server supplies connection + apiConfig
    expect(back.providers[0].apiConfig?.apiKey).toBe("server-key");
  });
});

describe("swap engine result serialization", () => {
  it("round-trips instructions, luts, quote and the BN output amount", () => {
    const result: SwapEngineResult = {
      swapInstructions: [ix()],
      setupInstructions: [ix()],
      swapLuts: [lut()],
      quoteResponse: {
        inAmount: "1000",
        outAmount: "2000",
        otherAmountThreshold: "1990",
        slippageBps: 50,
        provider: SwapProvider.JUPITER,
      },
      outputAmountNative: new BN("1990"),
      provider: SwapProvider.JUPITER,
    };

    const back = deserializeSwapEngineResult(serializeSwapEngineResult(result));

    expect(back.provider).toBe(SwapProvider.JUPITER);
    expect(back.outputAmountNative.eq(new BN("1990"))).toBe(true);
    expect(back.quoteResponse.outAmount).toBe("2000");
    expect(back.swapInstructions[0].programId).toBeInstanceOf(PublicKey);
    expect(back.swapLuts[0].state.addresses.length).toBe(2);
  });
});
