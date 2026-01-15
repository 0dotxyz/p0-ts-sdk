import BN from "bn.js";
import BigNumber from "bignumber.js";

import { FeedResponse, SWITCHBOARD_ONDEMANDE_PRICE_PRECISION } from "~/vendor/switchboard_pull";
import { BankType } from "~/services/bank";
import { MAX_CONFIDENCE_INTERVAL_RATIO, SWB_PRICE_CONF_INTERVALS } from "~/constants";

import { capConfidenceInterval } from "./compute.utils";
import { OraclePrice, SwbOracleAiDataByKey } from "../types";

/**
 * Maps Switchboard banks to their corresponding oracle prices using feed data and crossbar responses
 * @param banks - Array of bank objects
 * @param swbOracleAiDataByKey - Oracle account information indexed by oracle key
 * @param crossbarResponse - Crossbar feed response data indexed by feed ID
 * @returns Map of bank addresses to their corresponding oracle prices
 */
export const mapSwbBanksToOraclePrices = (
  banks: BankType[],
  swbOracleAiDataByKey: SwbOracleAiDataByKey,
  crossbarResponse: Record<string, FeedResponse | undefined>
): Map<string, OraclePrice> => {
  const bankOraclePriceMap = new Map<string, OraclePrice>();

  banks.forEach((bank) => {
    const oracleKey = bank.config.oracleKeys[0]!.toBase58();
    const oracleData = swbOracleAiDataByKey[oracleKey];
    const oracleFeed = oracleData?.feedHash;
    if (oracleFeed && oracleData && crossbarResponse) {
      const crossbarData = crossbarResponse[oracleFeed]?.results;
      const timestamp = new Date().getTime().toString();

      const oraclePrice = parseSwbOraclePriceData(
        crossbarData ?? new BN(oracleData.rawPrice),
        new BN(oracleData.stdev),
        timestamp,
        oracleData
      );
      if (oraclePrice) {
        bankOraclePriceMap.set(bank.address.toBase58(), oraclePrice);
      }
    } else {
      console.warn(
        `No oracle feed found for bank ${bank.address.toBase58()} oracleKey ${oracleKey}`
      );
    }
  });

  return bankOraclePriceMap;
};

/**
 * Maps broken Switchboard feeds to oracle prices using Birdeye fallback data
 * @param banks - Array of bank objects
 * @param swbOracleAiDataByKey - Oracle account information indexed by oracle key
 * @param birdeyeResponse - Birdeye price data indexed by feed ID
 * @returns Map of bank addresses to their corresponding oracle prices from Birdeye fallback
 */
export const mapBrokenFeedsToOraclePrices = (
  banks: BankType[],
  swbOracleAiDataByKey: SwbOracleAiDataByKey,
  birdeyeResponse: Record<string, number>
): Map<string, OraclePrice> => {
  const bankOraclePriceMap = new Map<string, OraclePrice>();

  banks.forEach((bank) => {
    const oracleKey = bank.config.oracleKeys[0]!.toBase58();
    const oracleData = swbOracleAiDataByKey[oracleKey];
    const oracleFeed = oracleData?.feedHash;
    const birdeyeData = oracleFeed ? birdeyeResponse[oracleFeed] : undefined;
    if (oracleFeed && oracleData && birdeyeData) {
      const timestamp = new Date().getTime().toString();

      const oraclePrice = parseSwbOraclePriceData(
        [birdeyeData],
        new BN(oracleData.stdev),
        timestamp,
        oracleData
      );
      if (oraclePrice) {
        bankOraclePriceMap.set(bank.address.toBase58(), oraclePrice);
      }
    } else {
      // Bank not found in birdeye fallback skipping
    }
  });

  return bankOraclePriceMap;
};

export function parseSwbOraclePriceData(
  price: number[] | BN,
  stdDev: BN,
  timestamp: string,
  oracleData: {
    queue: string;
    feedHash: string;
    maxVariance: string;
    minResponses: number;
    rawPrice: string;
    stdev: string;
  }
): OraclePrice {
  const swbPrice = Array.isArray(price)
    ? new BigNumber(median(price))
    : new BigNumber(price.toString()).div(10 ** SWITCHBOARD_ONDEMANDE_PRICE_PRECISION);
  const swbConfidence = new BigNumber(stdDev.toString()).times(SWB_PRICE_CONF_INTERVALS);
  const swbConfidenceCapped = capConfidenceInterval(
    swbPrice,
    swbConfidence,
    MAX_CONFIDENCE_INTERVAL_RATIO
  );
  const swbLowestPrice = swbPrice.minus(swbConfidenceCapped);
  const swbHighestPrice = swbPrice.plus(swbConfidenceCapped);

  return {
    priceRealtime: {
      price: swbPrice,
      confidence: swbConfidenceCapped,
      lowestPrice: swbLowestPrice,
      highestPrice: swbHighestPrice,
    },
    priceWeighted: {
      price: swbPrice,
      confidence: swbConfidenceCapped,
      lowestPrice: swbLowestPrice,
      highestPrice: swbHighestPrice,
    },
    timestamp: new BigNumber(timestamp),
    switchboardData: oracleData,
  };
}

function median(values: number[]): number {
  if (values.length === 0) {
    throw new Error("Input array is empty");
  }

  // Sorting values, preventing original array
  // from being mutated.
  values = [...values].sort((a, b) => a - b);

  const half = Math.floor(values.length / 2);

  return values.length % 2 ? values[half] : (values[half - 1] + values[half]) / 2;
}
