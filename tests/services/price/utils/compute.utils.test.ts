import { BigNumber } from "bignumber.js";
import { describe, expect, it, vi } from "vitest";

import { OracleSetup } from "~/services/bank";
import {
  capConfidenceInterval,
  getPrice,
  parsePriceInfo,
  PriceBias,
  type OraclePrice,
} from "~/services/price";

const component = (price: number, spread: number) => ({
  price: new BigNumber(price),
  confidence: new BigNumber(spread),
  lowestPrice: new BigNumber(price - spread),
  highestPrice: new BigNumber(price + spread),
});
const oraclePrice: OraclePrice = {
  priceRealtime: component(100, 2),
  priceWeighted: component(98, 1),
  timestamp: new BigNumber(0),
};

describe("getPrice", () => {
  it("returns the realtime price, or its lowest or highest bound by bias", () => {
    expect(getPrice(oraclePrice).toNumber()).toBe(100);
    expect(getPrice(oraclePrice, PriceBias.Lowest).toNumber()).toBe(98);
    expect(getPrice(oraclePrice, PriceBias.Highest).toNumber()).toBe(102);
  });

  it("reads the time-weighted price when asked", () => {
    expect(getPrice(oraclePrice, PriceBias.None, true).toNumber()).toBe(98);
    expect(getPrice(oraclePrice, PriceBias.Lowest, true).toNumber()).toBe(97);
  });
});

describe("capConfidenceInterval", () => {
  const maxRatio = new BigNumber(0.05);

  it("caps the confidence at the max ratio of the price", () => {
    expect(capConfidenceInterval(new BigNumber(100), new BigNumber(8), maxRatio).toNumber()).toBe(
      5
    );
  });

  it("keeps a confidence under the cap", () => {
    expect(capConfidenceInterval(new BigNumber(100), new BigNumber(3), maxRatio).toNumber()).toBe(
      3
    );
  });
});

describe("parsePriceInfo", () => {
  it("prices a bank without an oracle at zero", () => {
    const price = parsePriceInfo(OracleSetup.None, new Uint8Array());
    expect(price.priceRealtime.price.toNumber()).toBe(0);
    expect(price.priceWeighted.price.toNumber()).toBe(0);
  });

  it("rejects a setup it can't read from raw account data", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => parsePriceInfo(OracleSetup.SwitchboardPull, new Uint8Array())).toThrow(
      'Invalid oracle setup "SwitchboardPull"'
    );
  });
});
