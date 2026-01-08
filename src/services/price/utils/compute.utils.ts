import BigNumber from "bignumber.js";

import { decodeSwitchboardPullFeedData } from "~/vendor/switchboard_pull";
import { OracleSetup } from "~/services/bank/types";

import { OraclePrice, PriceWithConfidence, PriceBias } from "../types";

import { parseSwbOraclePriceData } from "./swb-data.utils";
import { parseRpcPythPriceData } from "./pyth-data.utils";

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
  let maxConfidenceInterval = price.times(maxConfidence);

  return BigNumber.min(confidence, maxConfidenceInterval);
}

function parseOraclePriceData(
  oracleSetup: OracleSetup,
  rawData: Buffer
): OraclePrice {
  switch (oracleSetup) {
    case OracleSetup.PythPushOracle:
    case OracleSetup.StakedWithPythPush:
    case OracleSetup.KaminoPythPush: {
      return parseRpcPythPriceData(rawData);
    }

    // deprecated
    case OracleSetup.PythLegacy:
    case OracleSetup.SwitchboardV2: {
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
    case OracleSetup.SwitchboardPull:
      const pullFeedDAta = decodeSwitchboardPullFeedData(rawData);

      return parseSwbOraclePriceData(
        pullFeedDAta.result.value,
        pullFeedDAta.result.std_dev,
        pullFeedDAta.last_update_timestamp.toString(),
        {
          queue: pullFeedDAta.queue.toBase58(),
          feedHash: Buffer.from(pullFeedDAta.feed_hash).toString("hex"),
          maxVariance: pullFeedDAta.max_variance.toString(),
          minResponses: pullFeedDAta.min_responses,
          rawPrice: pullFeedDAta.result.value.toString(),
          stdev: pullFeedDAta.result.std_dev.toString(),
        }
      );
    default:
      console.error("Invalid oracle setup", oracleSetup);
      throw new Error(`Invalid oracle setup "${oracleSetup}"`);
  }
}

export { parseOraclePriceData as parsePriceInfo };
