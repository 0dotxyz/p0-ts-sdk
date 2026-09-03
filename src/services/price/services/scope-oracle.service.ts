import { Connection } from "@solana/web3.js";
import BigNumber from "bignumber.js";

import { OraclePrice, OraclePriceDto } from "../types";
import { getOracleSourceFromBank } from "../utils";

import { BankType } from "~/services/bank";
import { chunkedGetRawMultipleAccountInfoOrderedWithNulls } from "~/services/misc";
import { decodeScopePriceAtIndex } from "~/vendor/scope";


type FetchScopeOracleOnChainOpts = {
  mode: "on-chain";
  connection: Connection;
};

type FetchScopeOracleApiOpts = {
  mode: "api";
  scopeOnchainData: {
    endpoint: string;
    queryKey?: string;
  };
};

export type ScopeOracleServiceOpts = FetchScopeOracleOnChainOpts | FetchScopeOracleApiOpts;

/**
 * A Scope price is identified by the OraclePrices account plus the entry index within it,
 * so requests are keyed as "<oracleKey>:<entryIndex>".
 */
const scopeRequestKey = (bank: BankType): string | undefined => {
  const oracleKey = bank.config.oracleKeys[0]?.toBase58();
  const entryIndex = bank.config.scopeEntryIndex;
  // A Scope price is only identified together with its entry index; without it the bank is
  // unpriceable rather than silently read from entry 0.
  return oracleKey && entryIndex !== undefined ? `${oracleKey}:${entryIndex}` : undefined;
};

/**
 * Fetches Scope oracle data for all Scope-priced banks
 * @param banks - Array of bank objects
 * @param opts - Configuration including API endpoint usage and connection
 * @returns Promise resolving to map of bank addresses to their oracle prices
 */
export const fetchScopeOracleData = async (
  banks: BankType[],
  opts?: ScopeOracleServiceOpts
): Promise<{
  bankOraclePriceMap: Map<string, OraclePrice>;
}> => {
  const scopeBanks = banks.filter((bank) => getOracleSourceFromBank(bank).key === "scope");

  if (!scopeBanks.length) {
    return {
      bankOraclePriceMap: new Map<string, OraclePrice>(),
    };
  }

  if (!opts) {
    console.warn(
      `fetchScopeOracleData: no scopeOpts provided; ${scopeBanks.length} scope bank(s) will have zero prices`
    );
    return {
      bankOraclePriceMap: new Map<string, OraclePrice>(),
    };
  }

  const uniqueRequestKeys = Array.from(
    new Set(scopeBanks.map(scopeRequestKey).filter((key): key is string => key !== undefined))
  );

  let oraclePrices: Record<string, OraclePrice> = {};
  if (!uniqueRequestKeys.length) {
    console.warn(
      "fetchScopeOracleData: no scope bank carries a scopeEntryIndex; all priced at zero"
    );
  } else if (opts.mode === "api") {
    oraclePrices = await fetchScopeOraclePricesFromAPI(
      uniqueRequestKeys,
      opts.scopeOnchainData.endpoint,
      { queryKey: opts.scopeOnchainData.queryKey }
    );
  } else {
    oraclePrices = await fetchScopeOraclePricesFromChain(uniqueRequestKeys, opts.connection);
  }

  const bankOraclePriceMap = new Map<string, OraclePrice>();
  const nowSeconds = Math.floor(Date.now() / 1000);

  scopeBanks.forEach((bank) => {
    const requestKey = scopeRequestKey(bank);
    let oraclePrice = requestKey ? oraclePrices[requestKey] : undefined;

    if (!oraclePrice || nowSeconds - oraclePrice.timestamp.toNumber() > bank.config.oracleMaxAge) {
      oraclePrice = {
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
        timestamp: oraclePrice?.timestamp ?? new BigNumber(0),
      };
    }

    bankOraclePriceMap.set(bank.address.toBase58(), oraclePrice);
  });

  return {
    bankOraclePriceMap,
  };
};

/**
 * Fetches Scope oracle price data via internal API endpoint
 * @param requestKeys - Array of "<oracleKey>:<entryIndex>" request keys
 * @param apiEndpoint - Fetches scope oracle data with a GET request using the request keys as params
 * @returns Promise resolving to oracle prices indexed by request key
 */
export const fetchScopeOraclePricesFromAPI = async (
  requestKeys: string[],
  apiEndpoint: string,
  opts?: { queryKey?: string }
): Promise<Record<string, OraclePrice>> => {
  const queryKey = opts?.queryKey ?? "scopeKeys";
  const response = await fetch(`${apiEndpoint}?${queryKey}=${requestKeys.join(",")}`);

  if (!response.ok) {
    throw new Error("Failed to fetch scope oracle data");
  }

  const { data } = (await response.json()) as { data: Record<string, OraclePriceDto> };

  return Object.fromEntries(
    Object.entries(data).map(([key, oraclePrice]) => [
      key,
      {
        priceRealtime: {
          price: BigNumber(oraclePrice.priceRealtime.price),
          confidence: BigNumber(oraclePrice.priceRealtime.confidence),
          lowestPrice: BigNumber(oraclePrice.priceRealtime.lowestPrice),
          highestPrice: BigNumber(oraclePrice.priceRealtime.highestPrice),
        },
        priceWeighted: {
          price: BigNumber(oraclePrice.priceWeighted.price),
          confidence: BigNumber(oraclePrice.priceWeighted.confidence),
          lowestPrice: BigNumber(oraclePrice.priceWeighted.lowestPrice),
          highestPrice: BigNumber(oraclePrice.priceWeighted.highestPrice),
        },
        timestamp: BigNumber(oraclePrice.timestamp),
      },
    ])
  ) as Record<string, OraclePrice>;
};

/**
 * Fetches Scope oracle data directly from the blockchain via RPC connection
 * @param requestKeys - Array of "<oracleKey>:<entryIndex>" request keys
 * @param connection - Solana RPC connection instance
 * @returns Promise resolving to oracle price data indexed by request key
 */
export const fetchScopeOraclePricesFromChain = async (
  requestKeys: string[],
  connection: Connection
): Promise<Record<string, OraclePrice>> => {
  const uniqueOracleKeys = Array.from(new Set(requestKeys.map((key) => key.split(":")[0])));
  const oracleAis = await chunkedGetRawMultipleAccountInfoOrderedWithNulls(
    connection,
    uniqueOracleKeys
  );

  const accountDataByKey: Record<string, Buffer | undefined> = {};
  uniqueOracleKeys.forEach((oracleKey, index) => {
    accountDataByKey[oracleKey] = oracleAis[index]?.data;
  });

  const oraclePriceByRequestKey: Record<string, OraclePrice> = {};

  for (const requestKey of requestKeys) {
    const [oracleKey, entryIndexRaw] = requestKey.split(":");
    const data = accountDataByKey[oracleKey];

    let price = new BigNumber(0);
    let timestamp = new BigNumber(0);
    if (data) {
      try {
        const entry = decodeScopePriceAtIndex(data, Number(entryIndexRaw));
        price = entry.price;
        timestamp = new BigNumber(entry.unixTimestamp);
      } catch (e) {
        console.error(`Failed to decode scope entry ${requestKey}`, e);
      }
    }

    // Scope prices carry no confidence interval.
    oraclePriceByRequestKey[requestKey] = {
      priceRealtime: {
        price,
        confidence: new BigNumber(0),
        lowestPrice: price,
        highestPrice: price,
      },
      priceWeighted: {
        price,
        confidence: new BigNumber(0),
        lowestPrice: price,
        highestPrice: price,
      },
      timestamp,
    };
  }

  return oraclePriceByRequestKey;
};
