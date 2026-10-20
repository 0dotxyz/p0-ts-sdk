import { AccountRole, getBase64Decoder, type Address } from "@solana/kit";
import { describe, expect, it, vi } from "vitest";

import { addr } from "../../../../../helpers/addresses";

import { ADDRESS_LOOKUP_TABLE_FOR_SWAP } from "~/constants";
import { jupiterAdapter } from "~/services/account/services/swap-engine/adapters/jupiter.adapter";
import type { SwapEngineRequest } from "~/services/account/services/swap-engine/types";
import { SwapProvider } from "~/services/account/types";

const projectLutAddresses = [addr(), addr()];
const routerLut = addr();
const routerLutAddresses = [addr()];
const swapProgram = addr();

// The project's swap lookup table, and a referral fee account that exists or doesn't
function rpc({ feeAccountExists }: { feeAccountExists: boolean }) {
  const account = (data: unknown) => ({
    data,
    executable: false,
    lamports: 1n,
    owner: addr(),
    space: 0n,
  });
  return {
    getAccountInfo: () => ({
      send: async () => ({
        context: { slot: 1n },
        value: feeAccountExists ? account(["", "base64"]) : null,
      }),
    }),
    getMultipleAccounts: () => ({
      send: async () => ({
        context: { slot: 1n },
        value: [
          account({
            parsed: { info: { addresses: projectLutAddresses }, type: "lookupTable" },
            program: "address-lookup-table",
            space: 0n,
          }),
        ],
      }),
    }),
  } as never;
}

const jupiterIx = (programId: Address, byte: number) => ({
  programId,
  accounts: [{ pubkey: addr(), isSigner: false, isWritable: true }],
  data: getBase64Decoder().decode(new Uint8Array([byte])),
});

// The Router answers every /build with the same route, or fails for the rungs in `failing`
function stubRouter(failing: number[] = []) {
  const fetch = vi.fn(async (url: string) => {
    const maxAccounts = Number(new URL(url).searchParams.get("maxAccounts"));
    if (failing.includes(maxAccounts)) return new Response("no route", { status: 400 });
    return new Response(
      JSON.stringify({
        inAmount: "1000",
        outAmount: "990",
        otherAmountThreshold: "985",
        slippageBps: 50,
        swapInstruction: jupiterIx(swapProgram, 1),
        setupInstructions: [jupiterIx(addr(), 2)],
        addressesByLookupTableAddress: { [routerLut]: routerLutAddresses },
      })
    );
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

const footprint = {
  instructions: [],
  txFormat: { version: 0 as const, luts: {} },
  payer: addr(),
  sizeConstraint: 1000,
  maxSwapTotalAccounts: 40,
};
const request = (overrides: Partial<SwapEngineRequest> = {}): SwapEngineRequest => ({
  inputMint: addr(),
  outputMint: addr(),
  amountNative: 1000,
  inputDecimals: 6,
  outputDecimals: 6,
  slippageBps: 50,
  taker: addr(),
  destinationTokenAccount: addr(),
  rpc: rpc({ feeAccountExists: false }),
  footprint,
  providers: [{ provider: SwapProvider.JUPITER }],
  ...overrides,
});
const searchParams = (fetch: ReturnType<typeof stubRouter>) =>
  fetch.mock.calls.map(([url]) => new URL(url).searchParams);

describe("jupiterAdapter.buildCandidates", () => {
  it("asks the Router for a route per maxAccounts rung under the budget, fit for a Jito bundle", async () => {
    const fetch = stubRouter();
    const req = request();

    await jupiterAdapter.buildCandidates(req);

    const params = searchParams(fetch);
    expect(params.map((p) => p.get("maxAccounts"))).toEqual(["36", "30", "24"]);
    expect(params[0].get("forJitoBundle")).toBe("true");
    expect(params[0].get("excludeDexes")).toBe("GoonFi V2");
    expect(params[0].get("wrapAndUnwrapSol")).toBe("false");
    expect(params[0].get("destinationTokenAccount")).toBe(req.destinationTokenAccount);
    expect(params[0].get("slippageBps")).toBe("50");
  });

  it("never asks for fewer than 16 accounts", async () => {
    const fetch = stubRouter();
    await jupiterAdapter.buildCandidates(
      request({ footprint: { ...footprint, maxSwapTotalAccounts: 18 } })
    );

    expect(searchParams(fetch).map((p) => p.get("maxAccounts"))).toEqual(["16"]);
  });

  it("charges the platform fee only into an existing referral fee account", async () => {
    const withAccount = stubRouter();
    await jupiterAdapter.buildCandidates(
      request({ platformFeeBps: 20, rpc: rpc({ feeAccountExists: true }) })
    );
    expect(searchParams(withAccount)[0].get("platformFeeBps")).toBe("20");
    expect(searchParams(withAccount)[0].get("feeAccount")).not.toBeNull();

    const withoutAccount = stubRouter();
    await jupiterAdapter.buildCandidates(request({ platformFeeBps: 20 }));
    expect(searchParams(withoutAccount)[0].has("platformFeeBps")).toBe(false);
    expect(searchParams(withoutAccount)[0].has("feeAccount")).toBe(false);
  });

  it("decodes the route's instructions and adds the project's lookup table to the Router's", async () => {
    stubRouter();

    const [route] = await jupiterAdapter.buildCandidates(request());

    expect(route.swapInstructions).toEqual([
      {
        programAddress: swapProgram,
        accounts: [{ address: expect.any(String), role: AccountRole.WRITABLE }],
        data: new Uint8Array([1]),
      },
    ]);
    expect(route.setupInstructions).toHaveLength(1);
    expect(route.luts).toEqual({
      [routerLut]: routerLutAddresses,
      [ADDRESS_LOOKUP_TABLE_FOR_SWAP]: projectLutAddresses,
    });
    expect(route).toMatchObject({
      outAmountNative: 990n,
      otherAmountThresholdNative: 985n,
      quoteResult: { outAmount: "990", provider: SwapProvider.JUPITER },
      label: "jupiter:maxAccounts=36",
    });
  });

  it("keeps the rungs that build, and throws the Router's error when none do", async () => {
    stubRouter([36]);
    const routes = await jupiterAdapter.buildCandidates(request());
    expect(routes.map((r) => r.label)).toEqual([
      "jupiter:maxAccounts=30",
      "jupiter:maxAccounts=24",
    ]);

    stubRouter([36, 30, 24]);
    await expect(jupiterAdapter.buildCandidates(request())).rejects.toThrow(/status 400/);
  });
});
