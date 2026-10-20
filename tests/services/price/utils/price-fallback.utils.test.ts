import { describe, expect, it, vi } from "vitest";

import { getFallbackPricesByFeedId, getFallbackPricesForMints } from "~/services/price";

const endpoint = "http://app.test/api/tokens/multi";

// The app's token price endpoint: `value` per requested mint
function stubTokenPrices(prices: Record<string, number>, init: { ok?: boolean } = {}) {
  const fetch = vi.fn(async () => {
    const data = Object.fromEntries(
      Object.entries(prices).map(([mint, value]) => [
        mint,
        { value, updateUnixTime: 0, updateHumanTime: "" },
      ])
    );
    return new Response(JSON.stringify({ success: true, data }), {
      status: init.ok === false ? 500 : 200,
    });
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

describe("getFallbackPricesForMints", () => {
  it("returns each mint's price from the endpoint", async () => {
    const fetch = stubTokenPrices({ mintA: 1.5, mintB: 150 });

    expect(await getFallbackPricesForMints(["mintA", "mintB"], endpoint)).toEqual({
      mintA: 1.5,
      mintB: 150,
    });
    expect(fetch).toHaveBeenCalledWith(`${endpoint}?mintList=mintA,mintB`);
  });

  it("sends the mints under the given query key", async () => {
    const fetch = stubTokenPrices({});
    await getFallbackPricesForMints(["mintA"], endpoint, { queryKey: "mints" });
    expect(fetch).toHaveBeenCalledWith(`${endpoint}?mints=mintA`);
  });

  it("returns no prices, with a warning, when the endpoint fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    stubTokenPrices({ mintA: 1.5 }, { ok: false });

    expect(await getFallbackPricesForMints(["mintA"], endpoint)).toEqual({});
    expect(warn).toHaveBeenCalledOnce();
  });
});

describe("getFallbackPricesByFeedId", () => {
  it("keys each mint's price by its feed", async () => {
    stubTokenPrices({ mintA: 1.5 });

    expect(
      await getFallbackPricesByFeedId([{ feedId: "feedA", mintAddress: "mintA" }], endpoint)
    ).toEqual({ feedA: 1.5 });
  });
});
