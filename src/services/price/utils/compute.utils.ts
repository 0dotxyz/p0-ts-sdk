import type { ReadonlyUint8Array } from "@solana/kit";
import BigNumber from "bignumber.js";

import { OraclePrice, PriceWithConfidence, PriceBias } from "../types";

import { getOracleSourceFromOracleSetup } from "./detection.utils";
import { parseRpcPythPriceData } from "./pyth-data.utils";

import { OracleSetup } from "~/services/bank/types";

export function getPriceWithConfidence(
  oraclePrice: OraclePrice,
  weighted: boolean
): PriceWithConfidence {
  return weighted ? oraclePrice.priceWeighted : oraclePrice.priceRealtime;
}

export function getPrice(
  oraclePrice: OraclePrice,
  priceBias: PriceBias = PriceBias.None,
  weightedPrice: boolean = false
): BigNumber {
  const price = getPriceWithConfidence(oraclePrice, weightedPrice);
  switch (priceBias) {
    case PriceBias.Lowest:
      return price.lowestPrice;
    case PriceBias.Highest:
      return price.highestPrice;
    case PriceBias.None:
      return price.price;
  }
}

export function capConfidenceInterval(
  price: BigNumber,
  confidence: BigNumber,
  maxConfidence: BigNumber
): BigNumber {
  const maxConfidenceInterval = price.times(maxConfidence);

  return BigNumber.min(confidence, maxConfidenceInterval);
}

function parseOraclePriceData(oracleSetup: OracleSetup, rawData: ReadonlyUint8Array): OraclePrice {
  const oracleSourceKey = getOracleSourceFromOracleSetup(oracleSetup).key;
  switch (oracleSourceKey) {
    case "pyth": {
      return parseRpcPythPriceData(rawData);
    }

    // deprecated
    case "unknown": {
      return {
        priceRealtime: {
          price: new BigNumber(0),
          confidence: new BigNumber(0),
          lowestPrice: new BigNumber(0),
          highestPrice: new BigNumber(0),
        },
        priceWeighted: {
          price: new BigNumber(0),
          confidence: new BigNumber(0),
          lowestPrice: new BigNumber(0),
          highestPrice: new BigNumber(0),
        },
        timestamp: new BigNumber(0),
      };
    }
    default:
      console.error("Invalid oracle setup", oracleSetup);
      throw new Error(`Invalid oracle setup "${oracleSetup}"`);
  }
}

export { parseOraclePriceData as parsePriceInfo };
