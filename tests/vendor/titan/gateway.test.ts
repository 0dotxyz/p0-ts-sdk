import { encode } from "@msgpack/msgpack";
import {
  AccountRole,
  address,
  getAddressDecoder,
  isSignerRole,
  isWritableRole,
  type Instruction,
} from "@solana/kit";
import { describe, expect, it, vi } from "vitest";

import { key } from "../../helpers/addresses";

import {
  buildTitanTemplate,
  deserializeTitanWireInstruction,
  encodeTitanTemplate,
  fetchTitanQuoteSwapV3,
  selectGatewayRoute,
  type SwapRoute,
} from "~/vendor/titan";

// Recorded from the web3.js implementation this replaced; never update with `-u`.

const jito = address("jitodontfronttitanspzero1111111111111111111");
const toWire = (built: Instruction) => ({
  programId: built.programAddress,
  keys: (built.accounts ?? []).map((a) => [
    a.address,
    isSignerRole(a.role),
    isWritableRole(a.role),
  ]),
  data: Buffer.from(built.data ?? []).toString("hex"),
});

const ix: Instruction = {
  programAddress: key(1),
  accounts: [
    { address: key(2), role: AccountRole.WRITABLE_SIGNER },
    { address: key(3), role: AccountRole.WRITABLE },
    { address: key(4), role: AccountRole.READONLY_SIGNER },
    { address: key(5), role: AccountRole.READONLY },
    { address: jito, role: AccountRole.READONLY },
  ],
  data: new Uint8Array([2, 1, 2, 3, 4]),
};

describe("titan wire format", () => {
  it("encodes a transaction template", () => {
    expect(
      encodeTitanTemplate(
        buildTitanTemplate({
          instructions: [ix],
          luts: { [key(10)]: [key(11), key(12)], [key(20)]: [key(21), key(22)] },
          extraAccountMetas: [{ address: key(30), role: AccountRole.WRITABLE }],
        })
      )
    ).toMatchSnapshot();
  });

  it("deserializes a wire instruction without the jitodontfront marker", () => {
    const [wire] = buildTitanTemplate({ instructions: [ix], luts: {} }).i;
    expect(toWire(deserializeTitanWireInstruction(wire))).toMatchSnapshot();
  });

  it("preserves lookup table insertion order", () => {
    const template = buildTitanTemplate({
      instructions: [],
      luts: { [key(40)]: [], [key(9)]: [] },
    });
    expect(template.a.map((lut) => getAddressDecoder().decode(lut.p))).toEqual([key(40), key(9)]);
  });
});

const route = (id: number, inAmount: number, outAmount: number) =>
  ({ inAmount, outAmount, instructions: [], addressLookupTables: [], id }) as unknown as SwapRoute;

describe("selectGatewayRoute", () => {
  const quotes = { a: route(1, 1_000, 990), b: route(2, 990, 995), dart: route(3, 0, 0) };

  it("picks the most output for ExactIn and the least input for ExactOut", () => {
    expect(selectGatewayRoute({ quotes }, "ExactIn")).toBe(quotes.b);
    expect(selectGatewayRoute({ quotes }, "ExactOut")).toBe(quotes.b);
    expect(
      selectGatewayRoute({ quotes: { a: quotes.a, c: route(4, 980, 900) } }, "ExactOut")
    ).toEqual(route(4, 980, 900));
  });

  it("honors the gateway's expected winner, unless it quotes zero", () => {
    expect(selectGatewayRoute({ quotes, metadata: { ExpectedWinner: "a" } }, "ExactIn")).toBe(
      quotes.a
    );
    expect(selectGatewayRoute({ quotes, metadata: { ExpectedWinner: "dart" } }, "ExactIn")).toBe(
      quotes.b
    );
  });

  it("finds nothing when every route quotes zero", () => {
    expect(selectGatewayRoute({ quotes: { dart: quotes.dart } }, "ExactIn")).toBeNull();
  });
});

describe("fetchTitanQuoteSwapV3", () => {
  const basePath = "http://titan.test/api/v1";
  const params = {
    basePath,
    apiKey: "secret",
    inputMint: "inMint",
    outputMint: "outMint",
    amount: 1_000,
    userPublicKey: "taker",
    outputAccount: "ata",
  };

  function stubGateway(response: Response) {
    const fetch = vi.fn(async () => response);
    vi.stubGlobal("fetch", fetch);
    return fetch;
  }
  const msgpack = (body: unknown) => new Response(encode(body));
  const requested = (fetch: ReturnType<typeof stubGateway>) => {
    const [url, init] = fetch.mock.calls[0] as unknown as [
      string,
      { headers: Record<string, string> },
    ];
    return { params: new URL(url).searchParams, headers: init.headers };
  };

  it("asks for a V3 swap sized by numeric limits, authorized by the API key", async () => {
    const fetch = stubGateway(msgpack({ quotes: { a: route(1, 1_000, 990) } }));

    const { route: best } = await fetchTitanQuoteSwapV3({
      ...params,
      slippageBps: 50,
      providers: ["Titan", "Jupiter"],
      addSizeConstraint: true,
      sizeConstraint: 900,
      accountsLimitTotal: 40,
      feeBps: 10,
    });

    const { params: query, headers } = requested(fetch);
    expect(query.get("titanSwapVersion")).toBe("3");
    expect(query.get("simulate")).toBe("false");
    expect(query.get("providers")).toBe("Titan,Jupiter");
    expect(query.get("sizeConstraint")).toBe("900");
    expect(query.get("accountsLimitTotal")).toBe("40");
    expect(query.has("feeBps")).toBe(false);
    expect(headers.Authorization).toBe("Bearer secret");
    expect(best.outAmount).toBe(990);
  });

  it("sends a transaction template instead of the numeric limits", async () => {
    const fetch = stubGateway(msgpack({ quotes: { a: route(1, 1_000, 990) } }));

    await fetchTitanQuoteSwapV3({ ...params, transactionTemplate: "tpl", sizeConstraint: 900 });

    const { params: query } = requested(fetch);
    expect(query.get("transactionTemplate")).toBe("tpl");
    expect(query.has("sizeConstraint")).toBe(false);
  });

  it("throws the gateway's error on a failed request", async () => {
    stubGateway(new Response("rate limited", { status: 429 }));
    await expect(fetchTitanQuoteSwapV3(params)).rejects.toThrow(
      "Titan gateway error (429): rate limited"
    );
  });

  it("throws a clear error on a body that isn't msgpack", async () => {
    stubGateway(new Response(new Uint8Array([0xc1])));
    await expect(fetchTitanQuoteSwapV3(params)).rejects.toThrow("undecodable response");
  });

  it("throws when no route quotes an amount", async () => {
    stubGateway(msgpack({ quotes: { dart: route(1, 0, 0) } }));
    await expect(fetchTitanQuoteSwapV3(params)).rejects.toThrow("No Titan V3 route found");
  });
});
