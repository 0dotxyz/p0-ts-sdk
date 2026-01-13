import { Connection } from "@solana/web3.js";
import BN from "bn.js";

import {
  CrossbarSimulatePayload,
  decodeSwitchboardPullFeedData,
  FeedResponse,
} from "~/vendor/switchboard_pull";
import { BankType, OracleSetup } from "~/services/bank";
import { chunkedGetRawMultipleAccountInfoOrdered } from "~/services/misc";

import { OraclePrice, SwbOracleAiDataByKey } from "../types";
import {
  getBirdeyeFallbackPricesByFeedId,
  mapBrokenFeedsToOraclePrices,
  mapSwbBanksToOraclePrices,
} from "../utils";

type FetchSwbOracleOnChainOpts = {
  mode: "on-chain";
  connection: Connection;
  crossbarEndpoint?: string;
};

type FetchSwbOracleApiOpts = {
  mode: "api";
  swbOnChainData: {
    endpoint: string;
    queryKey?: string;
  };
  swbCrossbarPrice: {
    endpoint: string;
    queryKey?: string;
  };
  stakedCollatData: {
    endpoint: string;
    queryKey?: string;
  };
  birdeyeFallback?: {
    endpoint: string;
    queryKey?: string;
  };
};

export type SwbOracleServiceOpts = FetchSwbOracleOnChainOpts | FetchSwbOracleApiOpts;

/**
 * Fetches comprehensive Switchboard oracle data including price feeds and broken feed detection
 * @param banks - Array of bank objects
 * @param opts - Optional configuration including API endpoint usage
 * @returns Promise resolving to map of bank addresses to their oracle prices
 */
export const fetchSwbOracleData = async (
  banks: BankType[],
  opts: SwbOracleServiceOpts
): Promise<{
  bankOraclePriceMap: Map<string, OraclePrice>;
}> => {
  // Step 1: Fetch Switchboard oracle map
  const switchboardBanks = banks.filter(
    (bank) =>
      bank.config.oracleSetup === OracleSetup.SwitchboardPull ||
      bank.config.oracleSetup === OracleSetup.SwitchboardV2 ||
      bank.config.oracleSetup === OracleSetup.KaminoSwitchboardPull
  );

  if (switchboardBanks.length === 0) {
    return {
      bankOraclePriceMap: new Map<string, OraclePrice>(),
    };
  }

  let swbOracleAiDataByKey: SwbOracleAiDataByKey;
  const oracleKeys = switchboardBanks.map((bank) => bank.config.oracleKeys[0]!.toBase58());
  if (opts.mode === "api") {
    swbOracleAiDataByKey = await fetchSwbOracleAccountsFromAPI(
      oracleKeys,
      opts.swbOnChainData.endpoint,
      { queryKey: opts.swbOnChainData.queryKey }
    );
  } else {
    swbOracleAiDataByKey = await fetchSwbOracleAccountsFromChain(oracleKeys, opts.connection);
  }

  // Step 4: Extract oracle keys for price fetching
  const swbFeedIds: string[] = [];
  const brokenSwbFeeds: { feedId: string; mintAddress: string }[] = [];

  Object.keys(swbOracleAiDataByKey).forEach((oracleKey) => {
    const oracleAiData = swbOracleAiDataByKey[oracleKey]!;

    const rawPriceBN = new BN(oracleAiData.rawPrice);

    const isFeedBroken =
      rawPriceBN.isZero() || rawPriceBN.eq(new BN(0.000001)) || rawPriceBN.eq(new BN(0.00000001));

    if (isFeedBroken) {
      const bank = switchboardBanks.find(
        (bank) => bank.config.oracleKeys[0]!.toBase58() === oracleKey
      );
      if (bank) {
        brokenSwbFeeds.push({
          feedId: oracleAiData.feedHash,
          mintAddress: bank.mint.toBase58(),
        });
      } else {
        console.warn(
          `Bank not found for oracle key ${oracleKey} - feed id ${oracleAiData.feedHash}`
        );
      }
    } else {
      swbFeedIds.push(oracleAiData.feedHash);
    }
  });

  // Step 5: Fetch oracle prices
  let crossbarResponse: Record<string, FeedResponse | undefined>;
  let birdeyeResponse: Record<string, number> = {};
  if (opts.mode === "api") {
    crossbarResponse = await fetchSwbOraclePricesFromAPI(
      swbFeedIds,
      opts.swbCrossbarPrice.endpoint,
      { queryKey: opts.swbCrossbarPrice.queryKey }
    );
    if (brokenSwbFeeds.length > 0 && opts.birdeyeFallback) {
      birdeyeResponse = await getBirdeyeFallbackPricesByFeedId(
        brokenSwbFeeds,
        opts.birdeyeFallback.endpoint,
        { queryKey: opts.birdeyeFallback.queryKey }
      );
    }
  } else {
    // Handle non-API endpoint case - placeholder for now
    crossbarResponse = await fetchSwbOraclePricesFromCrossbar(
      swbFeedIds,
      opts.crossbarEndpoint || "https://34.97.218.183.sslip.io",
      "https://crossbar.switchboard.xyz"
    );
    birdeyeResponse = {};
  }

  // Step 6: Map switchboardBanks to oracle prices
  const bankOraclePriceMap = mapSwbBanksToOraclePrices(
    switchboardBanks,
    swbOracleAiDataByKey,
    crossbarResponse
  );

  // Step 7: Map broken feeds to oracle prices
  const brokenFeedOraclePriceMap = mapBrokenFeedsToOraclePrices(
    switchboardBanks,
    swbOracleAiDataByKey,
    birdeyeResponse
  );

  // Step 8: Combine bank oracle prices and broken feed oracle prices
  const combinedOraclePriceMap = new Map<string, OraclePrice>();
  bankOraclePriceMap.forEach((oraclePrice, bankAddress) => {
    combinedOraclePriceMap.set(bankAddress, oraclePrice);
  });
  brokenFeedOraclePriceMap.forEach((oraclePrice, bankAddress) => {
    combinedOraclePriceMap.set(bankAddress, oraclePrice);
  });

  return {
    bankOraclePriceMap: combinedOraclePriceMap,
  };
};

/**
 * Fetches Switchboard oracle account information data via internal API endpoint
 * @param oracleKeys - Array of Switchboard oracle key strings
 * @returns Promise resolving to oracle account information indexed by oracle key
 */
export const fetchSwbOracleAccountsFromAPI = async (
  oracleKeys: string[],
  apiEndpoint: string,
  opts?: { queryKey?: string }
): Promise<SwbOracleAiDataByKey> => {
  const queryKey = opts?.queryKey ?? "oracleKeys";
  const swbOracleKeyMapResponse = await fetch(`${apiEndpoint}?${queryKey}=` + oracleKeys.join(","));

  if (!swbOracleKeyMapResponse.ok) {
    throw new Error("Failed to fetch swb oracle key map");
  }

  const { data } = (await swbOracleKeyMapResponse.json()) as { data: SwbOracleAiDataByKey };

  return data;
};

/**
 * Fetches Switchboard oracle account information data directly from the blockchain
 * @param oracleKeys - Array of Switchboard oracle key strings
 * @param connection - Solana RPC connection instance
 * @returns Promise resolving to oracle account information indexed by oracle key
 */
export const fetchSwbOracleAccountsFromChain = async (
  oracleKeys: string[],
  connection: Connection
): Promise<SwbOracleAiDataByKey> => {
  const swbOracleAiDataByKey: SwbOracleAiDataByKey = {};

  // Get oracle account info
  const oracleAis = await chunkedGetRawMultipleAccountInfoOrdered(connection, oracleKeys);

  // Process each oracle account
  oracleAis.forEach((oracleAi, idx) => {
    if (!oracleAi?.data || idx >= oracleKeys.length) return;

    const oracleKey = oracleKeys[idx];
    if (!oracleKey) return;

    const feedData = decodeSwitchboardPullFeedData(oracleAi.data);

    const feedHash = Buffer.from(feedData.feed_hash).toString("hex");
    const queue = feedData.queue.toBase58();
    const maxVariance = feedData.max_variance.toString();
    const minResponses = feedData.min_responses;
    const rawPrice = feedData.result.value.toString();
    const stdev = feedData.result.std_dev.toString();

    swbOracleAiDataByKey[oracleKey] = {
      queue,
      feedHash,
      maxVariance,
      minResponses,
      rawPrice,
      stdev,
    };
  });

  return swbOracleAiDataByKey;
};

/**
 * Fetches Switchboard oracle price data via internal API endpoint using feed IDs
 * @param swbFeedIds - Array of Switchboard feed ID strings
 * @param apiEndpoint - API endpoint for fetching Switchboard oracle prices
 * @returns Promise resolving to feed response data indexed by feed ID
 */
export const fetchSwbOraclePricesFromAPI = async (
  swbFeedIds: string[],
  apiEndpoint: string,
  opts?: { queryKey?: string }
): Promise<Record<string, FeedResponse | undefined>> => {
  const queryKey = opts?.queryKey ?? "feedIds";

  const response = await fetch(`${apiEndpoint}?${queryKey}=` + swbFeedIds.join(","));

  if (!response.ok) {
    throw new Error("Failed to fetch swb oracle data");
  }

  return (await response.json()) as Record<string, FeedResponse | undefined>;
};

/**
 * Fetches Switchboard oracle price data via internal API endpoint using feed IDs
 * @param swbFeedIds - Array of Switchboard feed ID strings
 * @param apiEndpoint - API endpoint for fetching Switchboard oracle prices
 * @returns Promise resolving to feed response data indexed by feed ID
 */
export const fetchSwbOraclePricesFromCrossbar = async (
  swbFeedIds: string[],
  primaryCrossbarEndpoint: string,
  fallbackCrossbarEndpoint: string
): Promise<Record<string, FeedResponse | undefined>> => {
  // fn to split array in chunks
  function chunkArray(array: string[], chunkSize: number): string[][] {
    const chunks: string[][] = [];
    for (let i = 0; i < array.length; i += chunkSize) {
      chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
  }

  // Split feed hashes into chunks of 5 (to avoid overloading crossbar)
  const chunks = chunkArray(swbFeedIds, 5);

  // Create requests that try primary first, then fallback on failure
  const requests = chunks.map((chunk) => {
    const swbFeedIdsChunk = chunk.join(",");
    return fetchCrossbarChunkWithFallback(
      swbFeedIdsChunk,
      primaryCrossbarEndpoint,
      fallbackCrossbarEndpoint
    );
  });

  // Execute all requests in parallel
  const results = await Promise.allSettled(requests);

  const feedMap: Record<string, FeedResponse | undefined> = {};
  swbFeedIds.forEach((swbFeedId) => {
    feedMap[swbFeedId] = undefined;
  });

  // Process successful responses
  for (const result of results) {
    if (result.status === "fulfilled") {
      const { validFeeds } = result.value;

      // Set valid feeds in the map
      validFeeds.forEach((feed) => {
        feedMap[feed.feedHash] = feed;
      });

      // Broken feeds remain undefined (already set above)
    } else if (result.status === "rejected") {
      console.error("Chunk request failed:", result.reason);
    }
  }

  return feedMap;
};

/**
 * Fetch a single chunk with fallback retry logic
 */
async function fetchCrossbarChunkWithFallback(
  swbFeedIdsChunk: string,
  primaryCrossbarEndpoint: string,
  fallbackCrossbarEndpoint: string
): Promise<{ validFeeds: FeedResponse[] }> {
  // Try primary endpoint first
  try {
    return await fetchSingleCrossbarChunk(primaryCrossbarEndpoint, swbFeedIdsChunk, true);
  } catch (primaryError) {
    console.warn("Primary endpoint failed, trying fallback:", primaryError);

    // If primary fails, try fallback endpoint
    try {
      return await fetchSingleCrossbarChunk(fallbackCrossbarEndpoint, swbFeedIdsChunk, false);
    } catch (fallbackError) {
      console.error("Both primary and fallback endpoints failed:", {
        primary: primaryError,
        fallback: fallbackError,
      });
      throw fallbackError;
    }
  }
}

/**
 * Fetch a single chunk from crossbar
 */
async function fetchSingleCrossbarChunk(
  endpoint: string,
  swbFeedIdsChunk: string,
  isPrimary: boolean
): Promise<{ validFeeds: FeedResponse[] }> {
  try {
    const response = await fetch(`${endpoint}/simulate/${swbFeedIdsChunk}`, {
      headers: {
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) {
      throw new Error(`${isPrimary ? "Primary" : "Fallback"} endpoint failed: ${response.status}`);
    }

    const payload = (await response.json()) as CrossbarSimulatePayload;

    // Check validity of crossbar response
    const brokenFeeds = payload
      .filter((feed) => {
        const result = feed.results[0];
        return result === null || result === undefined || isNaN(Number(result));
      })
      .map((feed) => feed.feedHash);

    const validFeeds = payload.filter((feed) => !brokenFeeds.includes(feed.feedHash));

    if (brokenFeeds.length > 0) {
      console.log(`Broken feeds from ${isPrimary ? "primary" : "fallback"} endpoint:`, brokenFeeds);
    }

    return { validFeeds };
  } catch (error) {
    console.error(`${isPrimary ? "Primary" : "Fallback"} crossbar chunk failed:`, error);
    throw error;
  }
}
