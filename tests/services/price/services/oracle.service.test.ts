import { BigNumber } from "bignumber.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { addr } from "../../../helpers/addresses";
import { mainnetBanks } from "../../../helpers/mainnet";

import { ZERO_ORACLE_KEY } from "~/constants";
import { BankType, OracleSetup, RiskTier } from "~/services/bank";
import { fetchOracleData } from "~/services/price";

const NOW_SECONDS = 1_760_000_000;
const endpoint = "http://pyth.test/prices";

const copyOfSol = (config: Partial<BankType["config"]>): BankType => ({
  ...mainnetBanks.sol,
  address: addr(),
  config: { ...mainnetBanks.sol.config, oracleKeys: [addr()], ...config },
});

// The price API serves `price` for every feed except those in `missing`
function stubPriceApi(price: number, missing: string[] = []) {
  const fetch = vi.fn(async (url: string) => {
    const feeds = (new URL(url).searchParams.get("pythOracleKeys")?.split(",") ?? []).filter(
      (feed) => !missing.includes(feed)
    );
    const component = {
      price: String(price),
      confidence: "0",
      lowestPrice: String(price),
      highestPrice: String(price),
    };
    const dto = { priceRealtime: component, priceWeighted: component, timestamp: "1" };
    return new Response(JSON.stringify({ data: Object.fromEntries(feeds.map((f) => [f, dto])) }));
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

const pythOpts = { mode: "api" as const, pythOnchainData: { endpoint } };
const priceOf = (map: Map<string, { priceRealtime: { price: BigNumber } }>, bank: BankType) =>
  map.get(bank.address)?.priceRealtime.price.toNumber();

describe("fetchOracleData", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW_SECONDS * 1000);
  });
  afterEach(() => vi.useRealTimers());

  it("prices a bank on the zero oracle key at zero, without fetching", async () => {
    const fetch = stubPriceApi(150);
    const zero = copyOfSol({ oracleKeys: [ZERO_ORACLE_KEY] });

    const { bankOraclePriceMap } = await fetchOracleData([zero], { pythOpts });

    expect(priceOf(bankOraclePriceMap, zero)).toBe(0);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("prices a Fixed bank at its fixed price", async () => {
    const fixed = copyOfSol({ oracleSetup: OracleSetup.Fixed, fixedPrice: new BigNumber(2) });

    const { bankOraclePriceMap } = await fetchOracleData([fixed], { pythOpts });

    expect(priceOf(bankOraclePriceMap, fixed)).toBe(2);
  });

  it("prices a PT-fixed bank at zero without its PT rate, not at the start price", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const ptFixed = copyOfSol({ oracleSetup: OracleSetup.PTFixed, fixedPrice: new BigNumber(0.9) });

    const { bankOraclePriceMap } = await fetchOracleData([ptFixed], { pythOpts });

    expect(priceOf(bankOraclePriceMap, ptFixed)).toBe(0);
  });

  it("prices collateral banks from Pyth, and a bank whose feed is missing at zero", async () => {
    const priced = copyOfSol({ oracleSetup: OracleSetup.PythPushOracle });
    const unpriced = copyOfSol({ oracleSetup: OracleSetup.PythPushOracle });
    stubPriceApi(150, [unpriced.config.oracleKeys[0]]);

    const { bankOraclePriceMap, mintOraclePriceMap } = await fetchOracleData([priced, unpriced], {
      pythOpts,
    });

    expect(priceOf(bankOraclePriceMap, priced)).toBe(150);
    expect(priceOf(bankOraclePriceMap, unpriced)).toBe(0);
    expect(mintOraclePriceMap.has(priced.mint)).toBe(true);
  });

  it("fetches isolated banks' prices only when asked to", async () => {
    stubPriceApi(150);
    const isolated = copyOfSol({
      oracleSetup: OracleSetup.PythPushOracle,
      riskTier: RiskTier.Isolated,
    });

    const skipped = await fetchOracleData([isolated], { pythOpts });
    const fetched = await fetchOracleData([isolated], {
      pythOpts,
      isolatedBanksOpts: { fetchPrices: true },
    });

    expect(skipped.bankOraclePriceMap.has(isolated.address)).toBe(false);
    expect(priceOf(fetched.bankOraclePriceMap, isolated)).toBe(150);
  });

  it("stamps the prices it makes up with the current unix time in seconds", async () => {
    const fixed = copyOfSol({ oracleSetup: OracleSetup.Fixed, fixedPrice: new BigNumber(2) });
    const zero = copyOfSol({ oracleKeys: [ZERO_ORACLE_KEY] });

    const { bankOraclePriceMap } = await fetchOracleData([fixed, zero], { pythOpts });

    expect(bankOraclePriceMap.get(fixed.address)?.timestamp.toNumber()).toBe(NOW_SECONDS);
    expect(bankOraclePriceMap.get(zero.address)?.timestamp.toNumber()).toBe(NOW_SECONDS);
  });
});
