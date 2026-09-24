import { address, getAddressDecoder, getBase64Encoder, type Address } from "@solana/kit";
import { describe, it, expect, vi, afterEach } from "vitest";

import banks from "../bank/fixtures/mainnet-banks.json";

import { decodeBank } from "~/accounts";
import { BankType, OracleSetup } from "~/services/bank/types";
import { parseBankRaw } from "~/services/bank/utils/deserialize.utils";
import { fetchScopeOracleData } from "~/services/price/services/scope-oracle.service";

const ORACLE_PRICES_KEY = address("AMjqm5S4QaAHWLv52jJiRpFNW1qo23F6ZM5ChCF5tYgc");
const baseBank = parseBankRaw(
  address(banks[0].address),
  decodeBank(getBase64Encoder().encode(banks[0].data))
);

let nextKey = 1;
const uniqueAddress = () => getAddressDecoder().decode(new Uint8Array(32).fill(nextKey++));

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
    const bankA = scopeBank({ address: uniqueAddress(), entryIndex: 13, oracleMaxAge: 3600 });
    const bankB = scopeBank({ address: uniqueAddress(), entryIndex: 21, oracleMaxAge: 3600 });
    const pythBank = scopeBank({
      address: uniqueAddress(),
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
    expect(bankOraclePriceMap.get(bankA.address)!.priceRealtime.price.toNumber()).toBe(103.44);
    expect(bankOraclePriceMap.get(bankB.address)!.priceRealtime.price.toNumber()).toBe(1.29);
    expect(bankOraclePriceMap.has(pythBank.address)).toBe(false);
  });

  it("zeroes prices older than the bank's oracleMaxAge, with no 0 -> default fallback", async () => {
    const now = Math.floor(Date.now() / 1000);
    const freshBank = scopeBank({ address: uniqueAddress(), entryIndex: 13, oracleMaxAge: 300 });
    const staleBank = scopeBank({ address: uniqueAddress(), entryIndex: 14, oracleMaxAge: 60 });
    const zeroAgeBank = scopeBank({ address: uniqueAddress(), entryIndex: 15, oracleMaxAge: 0 });

    stubFetch({
      [`${ORACLE_PRICES_KEY}:13`]: priceDto("100", `${now - 200}`),
      [`${ORACLE_PRICES_KEY}:14`]: priceDto("100", `${now - 200}`),
      [`${ORACLE_PRICES_KEY}:15`]: priceDto("100", `${now - 5}`),
    });

    const { bankOraclePriceMap } = await fetchScopeOracleData([freshBank, staleBank, zeroAgeBank], {
      mode: "api",
      scopeOnchainData: { endpoint: "https://example.com/api/oracles/scopeOracleData" },
    });

    expect(bankOraclePriceMap.get(freshBank.address)!.priceRealtime.price.toNumber()).toBe(100);
    expect(bankOraclePriceMap.get(staleBank.address)!.priceRealtime.price.isZero()).toBe(true);
    expect(bankOraclePriceMap.get(zeroAgeBank.address)!.priceRealtime.price.isZero()).toBe(true);
  });

  it("zeroes future-dated entries, which the program rejects", async () => {
    const now = Math.floor(Date.now() / 1000);
    const bank = scopeBank({ address: uniqueAddress(), entryIndex: 13, oracleMaxAge: 3600 });
    stubFetch({ [`${ORACLE_PRICES_KEY}:13`]: priceDto("100", `${now + 120}`) });

    const { bankOraclePriceMap } = await fetchScopeOracleData([bank], {
      mode: "api",
      scopeOnchainData: { endpoint: "https://example.com/api/oracles/scopeOracleData" },
    });

    expect(bankOraclePriceMap.get(bank.address)!.priceRealtime.price.isZero()).toBe(true);
  });

  it("prices a bank without scopeEntryIndex at zero instead of reading entry 0", async () => {
    const bank = scopeBank({ address: uniqueAddress(), oracleMaxAge: 3600 });
    const now = Math.floor(Date.now() / 1000);
    const fetchMock = stubFetch({
      [`${ORACLE_PRICES_KEY}:0`]: priceDto("100", `${now}`),
    });

    const { bankOraclePriceMap } = await fetchScopeOracleData([bank], {
      mode: "api",
      scopeOnchainData: { endpoint: "https://example.com/api/oracles/scopeOracleData" },
    });

    expect(bankOraclePriceMap.get(bank.address)!.priceRealtime.price.isZero()).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns no prices (upstream zero-fallback) when scopeOpts is omitted", async () => {
    const bank = scopeBank({ address: uniqueAddress(), entryIndex: 13, oracleMaxAge: 3600 });
    const { bankOraclePriceMap } = await fetchScopeOracleData([bank]);
    expect(bankOraclePriceMap.size).toBe(0);
  });

  it("zeroes banks whose entry is missing from the response", async () => {
    const bank = scopeBank({ address: uniqueAddress(), entryIndex: 42, oracleMaxAge: 3600 });
    stubFetch({});

    const { bankOraclePriceMap } = await fetchScopeOracleData([bank], {
      mode: "api",
      scopeOnchainData: { endpoint: "https://example.com/api/oracles/scopeOracleData" },
    });

    expect(bankOraclePriceMap.get(bank.address)!.priceRealtime.price.isZero()).toBe(true);
  });
});
