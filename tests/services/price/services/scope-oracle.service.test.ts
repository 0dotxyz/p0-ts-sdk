import { address, getBase64Decoder, getBase64Encoder, type Address } from "@solana/kit";
import { describe, it, expect, vi, afterEach } from "vitest";

import banks from "../../../fixtures/mainnet-banks.json";
import { addr } from "../../../helpers/addresses";
import { scopeAccountData } from "../../../helpers/scope";

import { BankType, OracleSetup } from "~/services/bank/types";
import { decodeBank } from "~/services/bank/utils/deserialize.utils";
import { fetchScopeOracleData } from "~/services/price/services/scope-oracle.service";

const ORACLE_PRICES_KEY = address("AMjqm5S4QaAHWLv52jJiRpFNW1qo23F6ZM5ChCF5tYgc");
const baseBank = decodeBank(address(banks[0].address), getBase64Encoder().encode(banks[0].data));

function scopeBank(opts: {
  address: Address;
  entryIndex?: number;
  oracleMaxAge: number;
  oracleSetup?: OracleSetup;
}): BankType {
  return {
    ...baseBank,
    address: opts.address,
    config: {
      ...baseBank.config,
      oracleSetup: opts.oracleSetup ?? OracleSetup.Scope,
      oracleKeys: [ORACLE_PRICES_KEY],
      scopeEntryIndex: opts.entryIndex,
      oracleMaxAge: opts.oracleMaxAge,
    },
  };
}

function priceDto(price: string, timestamp: string) {
  const component = { price, confidence: "0", lowestPrice: price, highestPrice: price };
  return { priceRealtime: component, priceWeighted: component, timestamp };
}

function stubFetch(data: Record<string, unknown>) {
  const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ data }) }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchScopeOracleData", () => {
  it("maps each scope bank to its own entry and skips non-scope banks", async () => {
    const bankA = scopeBank({ address: addr(), entryIndex: 13, oracleMaxAge: 3600 });
    const bankB = scopeBank({ address: addr(), entryIndex: 21, oracleMaxAge: 3600 });
    const pythBank = scopeBank({
      address: addr(),
      entryIndex: 0,
      oracleMaxAge: 3600,
      oracleSetup: OracleSetup.PythPushOracle,
    });

    const now = Math.floor(Date.now() / 1000);
    const fetchMock = stubFetch({
      [`${ORACLE_PRICES_KEY}:13`]: priceDto("103.44", `${now}`),
      [`${ORACLE_PRICES_KEY}:21`]: priceDto("1.29", `${now}`),
    });

    const { bankOraclePriceMap } = await fetchScopeOracleData([bankA, bankB, pythBank], {
      mode: "api",
      scopeOnchainData: { endpoint: "https://example.com/api/oracles/scopeOracleData" },
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(bankOraclePriceMap.size).toBe(2);
    expect(bankOraclePriceMap.get(bankA.address)?.priceRealtime.price.toNumber()).toBe(103.44);
    expect(bankOraclePriceMap.get(bankB.address)?.priceRealtime.price.toNumber()).toBe(1.29);
    expect(bankOraclePriceMap.has(pythBank.address)).toBe(false);
  });

  it("zeroes prices older than the bank's oracleMaxAge, with no 0 -> default fallback", async () => {
    const now = Math.floor(Date.now() / 1000);
    const freshBank = scopeBank({ address: addr(), entryIndex: 13, oracleMaxAge: 300 });
    const staleBank = scopeBank({ address: addr(), entryIndex: 14, oracleMaxAge: 60 });
    const zeroAgeBank = scopeBank({ address: addr(), entryIndex: 15, oracleMaxAge: 0 });

    stubFetch({
      [`${ORACLE_PRICES_KEY}:13`]: priceDto("100", `${now - 200}`),
      [`${ORACLE_PRICES_KEY}:14`]: priceDto("100", `${now - 200}`),
      [`${ORACLE_PRICES_KEY}:15`]: priceDto("100", `${now - 5}`),
    });

    const { bankOraclePriceMap } = await fetchScopeOracleData([freshBank, staleBank, zeroAgeBank], {
      mode: "api",
      scopeOnchainData: { endpoint: "https://example.com/api/oracles/scopeOracleData" },
    });

    expect(bankOraclePriceMap.get(freshBank.address)?.priceRealtime.price.toNumber()).toBe(100);
    expect(bankOraclePriceMap.get(staleBank.address)?.priceRealtime.price.isZero()).toBe(true);
    expect(bankOraclePriceMap.get(zeroAgeBank.address)?.priceRealtime.price.isZero()).toBe(true);
  });

  it("zeroes future-dated entries, which the program rejects", async () => {
    const now = Math.floor(Date.now() / 1000);
    const bank = scopeBank({ address: addr(), entryIndex: 13, oracleMaxAge: 3600 });
    stubFetch({ [`${ORACLE_PRICES_KEY}:13`]: priceDto("100", `${now + 120}`) });

    const { bankOraclePriceMap } = await fetchScopeOracleData([bank], {
      mode: "api",
      scopeOnchainData: { endpoint: "https://example.com/api/oracles/scopeOracleData" },
    });

    expect(bankOraclePriceMap.get(bank.address)?.priceRealtime.price.isZero()).toBe(true);
  });

  it("prices a bank without scopeEntryIndex at zero instead of reading entry 0", async () => {
    const bank = scopeBank({ address: addr(), oracleMaxAge: 3600 });
    const now = Math.floor(Date.now() / 1000);
    const fetchMock = stubFetch({
      [`${ORACLE_PRICES_KEY}:0`]: priceDto("100", `${now}`),
    });

    const { bankOraclePriceMap } = await fetchScopeOracleData([bank], {
      mode: "api",
      scopeOnchainData: { endpoint: "https://example.com/api/oracles/scopeOracleData" },
    });

    expect(bankOraclePriceMap.get(bank.address)?.priceRealtime.price.isZero()).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns no prices (upstream zero-fallback) when scopeOpts is omitted", async () => {
    const bank = scopeBank({ address: addr(), entryIndex: 13, oracleMaxAge: 3600 });
    const { bankOraclePriceMap } = await fetchScopeOracleData([bank]);
    expect(bankOraclePriceMap.size).toBe(0);
  });

  it("zeroes banks whose entry is missing from the response", async () => {
    const bank = scopeBank({ address: addr(), entryIndex: 42, oracleMaxAge: 3600 });
    stubFetch({});

    const { bankOraclePriceMap } = await fetchScopeOracleData([bank], {
      mode: "api",
      scopeOnchainData: { endpoint: "https://example.com/api/oracles/scopeOracleData" },
    });

    expect(bankOraclePriceMap.get(bank.address)?.priceRealtime.price.isZero()).toBe(true);
  });
});

describe("fetchScopeOracleData on chain", () => {
  // The OraclePrices account, read straight from the RPC
  const rpcServing = (data: Uint8Array) =>
    ({
      getMultipleAccounts: (addresses: Address[]) => ({
        send: async () => ({
          context: { slot: 1n },
          value: addresses.map(() => ({
            data: [getBase64Decoder().decode(data), "base64"],
            executable: false,
            lamports: 1n,
            owner: addr(),
            space: BigInt(data.length),
          })),
        }),
      }),
    }) as never;

  it("prices each bank from its entry in the OraclePrices account", async () => {
    const now = Math.floor(Date.now() / 1000);
    const bank = scopeBank({ address: addr(), entryIndex: 13, oracleMaxAge: 3600 });
    const data = scopeAccountData([
      { index: 13, value: 10_344_510_800n, exp: 8n, slot: 1n, timestamp: BigInt(now - 10) },
    ]);

    const { bankOraclePriceMap } = await fetchScopeOracleData([bank], {
      mode: "on-chain",
      rpc: rpcServing(data),
    });

    const price = bankOraclePriceMap.get(bank.address);
    expect(price?.priceRealtime.price.toNumber()).toBeCloseTo(103.445108, 9);
    expect(price?.priceWeighted.lowestPrice.toNumber()).toBeCloseTo(103.445108, 9);
  });

  it("prices a bank whose entry can't be decoded at zero", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const bank = scopeBank({ address: addr(), entryIndex: 7, oracleMaxAge: 3600 });
    const data = scopeAccountData([
      {
        index: 7,
        value: 1_000n,
        exp: 24n,
        slot: 1n,
        timestamp: BigInt(Math.floor(Date.now() / 1000)),
      },
    ]);

    const { bankOraclePriceMap } = await fetchScopeOracleData([bank], {
      mode: "on-chain",
      rpc: rpcServing(data),
    });

    expect(bankOraclePriceMap.get(bank.address)?.priceRealtime.price.isZero()).toBe(true);
  });
});
