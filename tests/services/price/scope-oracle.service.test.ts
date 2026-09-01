import { describe, it, expect, vi, afterEach } from "vitest";
import { PublicKey } from "@solana/web3.js";

import { fetchScopeOracleData } from "~/services/price";
import { BankType, OracleSetup } from "~/services/bank";

const ORACLE_PRICES_KEY = new PublicKey("AMjqm5S4QaAHWLv52jJiRpFNW1qo23F6ZM5ChCF5tYgc");

function scopeBank(opts: {
  address: PublicKey;
  entryIndex: number;
  oracleMaxAge: number;
  oracleSetup?: OracleSetup;
}): BankType {
  return {
    address: opts.address,
    mint: PublicKey.unique(),
    config: {
      oracleSetup: opts.oracleSetup ?? OracleSetup.Scope,
      oracleKeys: [ORACLE_PRICES_KEY],
      scopeEntryIndex: opts.entryIndex,
      oracleMaxAge: opts.oracleMaxAge,
    },
  } as unknown as BankType;
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
    const bankA = scopeBank({ address: PublicKey.unique(), entryIndex: 13, oracleMaxAge: 3600 });
    const bankB = scopeBank({ address: PublicKey.unique(), entryIndex: 21, oracleMaxAge: 3600 });
    const pythBank = scopeBank({
      address: PublicKey.unique(),
      entryIndex: 0,
      oracleMaxAge: 3600,
      oracleSetup: OracleSetup.PythPushOracle,
    });

    const now = Math.floor(Date.now() / 1000);
    const fetchMock = stubFetch({
      [`${ORACLE_PRICES_KEY.toBase58()}:13`]: priceDto("103.44", `${now}`),
      [`${ORACLE_PRICES_KEY.toBase58()}:21`]: priceDto("1.29", `${now}`),
    });

    const { bankOraclePriceMap } = await fetchScopeOracleData([bankA, bankB, pythBank], {
      mode: "api",
      scopeOnchainData: { endpoint: "https://example.com/api/oracles/scopeOracleData" },
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(bankOraclePriceMap.size).toBe(2);
    expect(bankOraclePriceMap.get(bankA.address.toBase58())!.priceRealtime.price.toNumber()).toBe(
      103.44
    );
    expect(bankOraclePriceMap.get(bankB.address.toBase58())!.priceRealtime.price.toNumber()).toBe(
      1.29
    );
    expect(bankOraclePriceMap.has(pythBank.address.toBase58())).toBe(false);
  });

  it("zeroes prices older than the bank's oracleMaxAge, with no 0 -> default fallback", async () => {
    const now = Math.floor(Date.now() / 1000);
    const freshBank = scopeBank({ address: PublicKey.unique(), entryIndex: 13, oracleMaxAge: 300 });
    const staleBank = scopeBank({ address: PublicKey.unique(), entryIndex: 14, oracleMaxAge: 60 });
    const zeroAgeBank = scopeBank({ address: PublicKey.unique(), entryIndex: 15, oracleMaxAge: 0 });

    stubFetch({
      [`${ORACLE_PRICES_KEY.toBase58()}:13`]: priceDto("100", `${now - 200}`),
      [`${ORACLE_PRICES_KEY.toBase58()}:14`]: priceDto("100", `${now - 200}`),
      [`${ORACLE_PRICES_KEY.toBase58()}:15`]: priceDto("100", `${now - 5}`),
    });

    const { bankOraclePriceMap } = await fetchScopeOracleData([freshBank, staleBank, zeroAgeBank], {
      mode: "api",
      scopeOnchainData: { endpoint: "https://example.com/api/oracles/scopeOracleData" },
    });

    expect(
      bankOraclePriceMap.get(freshBank.address.toBase58())!.priceRealtime.price.toNumber()
    ).toBe(100);
    expect(
      bankOraclePriceMap.get(staleBank.address.toBase58())!.priceRealtime.price.isZero()
    ).toBe(true);
    expect(
      bankOraclePriceMap.get(zeroAgeBank.address.toBase58())!.priceRealtime.price.isZero()
    ).toBe(true);
  });

  it("returns no prices (upstream zero-fallback) when scopeOpts is omitted", async () => {
    const bank = scopeBank({ address: PublicKey.unique(), entryIndex: 13, oracleMaxAge: 3600 });
    const { bankOraclePriceMap } = await fetchScopeOracleData([bank]);
    expect(bankOraclePriceMap.size).toBe(0);
  });

  it("zeroes banks whose entry is missing from the response", async () => {
    const bank = scopeBank({ address: PublicKey.unique(), entryIndex: 42, oracleMaxAge: 3600 });
    stubFetch({});

    const { bankOraclePriceMap } = await fetchScopeOracleData([bank], {
      mode: "api",
      scopeOnchainData: { endpoint: "https://example.com/api/oracles/scopeOracleData" },
    });

    expect(bankOraclePriceMap.get(bank.address.toBase58())!.priceRealtime.price.isZero()).toBe(
      true
    );
  });
});
