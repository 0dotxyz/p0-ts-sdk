import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { addr } from "../../../helpers/addresses";
import { makeBank } from "../../../helpers/factories";

import { OracleSetup } from "~/services/bank";
import { fetchPythOracleData } from "~/services/price";

const NOW_SECONDS = 1_760_000_000;
const endpoint = "http://pyth.test/prices";

const pythBank = (oracleSetup: OracleSetup, feed = addr()) =>
  makeBank({ config: { oracleSetup, oracleKeys: [feed] } });
const priceDto = (price: number) => {
  const component = {
    price: String(price),
    confidence: "0.5",
    lowestPrice: String(price - 0.5),
    highestPrice: String(price + 0.5),
  };
  return { priceRealtime: component, priceWeighted: component, timestamp: "1759999990" };
};

// Serves the API's price for every requested feed
function stubPriceApi(price: number) {
  const fetch = vi.fn(async (url: string) => {
    const feeds = new URL(url).searchParams.get("pythOracleKeys")?.split(",") ?? [];
    return new Response(
      JSON.stringify({ data: Object.fromEntries(feeds.map((feed) => [feed, priceDto(price)])) })
    );
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

const apiOpts = { mode: "api" as const, pythOnchainData: { endpoint } };

describe("fetchPythOracleData", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW_SECONDS * 1000);
  });
  afterEach(() => vi.useRealTimers());

  it("prices each Pyth bank from its feed, fetching a shared feed once", async () => {
    const fetch = stubPriceApi(150);
    const feed = addr();
    const a = pythBank(OracleSetup.PythPushOracle, feed);
    const b = pythBank(OracleSetup.KaminoPythPush, feed);

    const { bankOraclePriceMap } = await fetchPythOracleData([a, b], apiOpts);

    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0][0]).toBe(`${endpoint}?pythOracleKeys=${feed}`);
    expect(bankOraclePriceMap.get(a.address)?.priceRealtime.price.toNumber()).toBe(150);
    expect(bankOraclePriceMap.get(b.address)?.priceRealtime.price.toNumber()).toBe(150);
  });

  it("scales every price component of a multiplier bank by its exchange rate", async () => {
    stubPriceApi(150);
    const lst = pythBank(OracleSetup.PythLST);

    const { bankOraclePriceMap } = await fetchPythOracleData([lst], apiOpts, {
      [lst.address]: 1.2,
    });

    const price = bankOraclePriceMap.get(lst.address);
    expect(price?.priceRealtime.price.toNumber()).toBe(180);
    expect(price?.priceRealtime.confidence.toNumber()).toBe(0.6);
    expect(price?.priceWeighted.lowestPrice.toNumber()).toBeCloseTo(179.4);
    expect(price?.priceWeighted.highestPrice.toNumber()).toBeCloseTo(180.6);
  });

  it("leaves out a multiplier bank without a valid exchange rate", async () => {
    stubPriceApi(150);
    const missing = pythBank(OracleSetup.PythLST);
    const invalid = pythBank(OracleSetup.PTPyth);

    const { bankOraclePriceMap } = await fetchPythOracleData([missing, invalid], apiOpts, {
      [invalid.address]: Number.NaN,
    });

    expect(bankOraclePriceMap.has(missing.address)).toBe(false);
    expect(bankOraclePriceMap.has(invalid.address)).toBe(false);
  });

  it("prices a staked bank at its SOL feed, unscaled", async () => {
    stubPriceApi(150);
    const staked = pythBank(OracleSetup.StakedWithPythPush);

    const { bankOraclePriceMap } = await fetchPythOracleData([staked], apiOpts);

    expect(bankOraclePriceMap.get(staked.address)?.priceRealtime.price.toNumber()).toBe(150);
  });

  it("fetches nothing without Pyth banks", async () => {
    const fetch = stubPriceApi(150);

    const { bankOraclePriceMap } = await fetchPythOracleData(
      [pythBank(OracleSetup.Scope)],
      apiOpts
    );

    expect(fetch).not.toHaveBeenCalled();
    expect(bankOraclePriceMap.size).toBe(0);
  });
});
