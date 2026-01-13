import { Connection } from "@solana/web3.js";
import BigNumber from "bignumber.js";

import { BankType } from "~/services/bank";
import { chunkedGetRawMultipleAccountInfoOrdered } from "~/services/misc";

import { OraclePrice, OraclePriceDto } from "../types";
import {
  categorizePythBanks,
  extractPythOracleKeys,
  mapPythBanksToOraclePrices,
  parseRpcPythPriceData,
} from "../utils";

type ValidatorVoteAccountByBank = {
  [address: string]: string;
};

type FetchPythOracleOnChainOpts = {
  mode: "on-chain";
  connection: Connection;
  validatorVoteAccountByBank?: ValidatorVoteAccountByBank;
};

type FetchPythOracleApiOpts = {
  mode: "api";
  pythOnchainData: {
    endpoint: string;
    queryKey?: string;
  };
  stakedCollatData: {
    endpoint: string;
    queryKey?: string;
  };
  validatorVoteAccountByBank?: ValidatorVoteAccountByBank;
};

export type PythOracleServiceOpts = FetchPythOracleOnChainOpts | FetchPythOracleApiOpts;

/**
 * Fetches comprehensive Pyth oracle data including push oracles and staked collateral data
 * @param banks - Array of bank objects
 * @param opts - Optional configuration including API endpoint usage and connection
 * @returns Promise resolving to map of bank addresses to their oracle prices
 */
export const fetchPythOracleData = async (
  banks: BankType[],
  opts: PythOracleServiceOpts
): Promise<{
  bankOraclePriceMap: Map<string, OraclePrice>;
}> => {
  // Step 1: Categorize banks by oracle type
  const { pythPushBanks, pythStakedCollateralBanks, pythPushKaminosBanks } =
    categorizePythBanks(banks);

  if (!pythPushBanks.length && !pythStakedCollateralBanks.length && !pythPushKaminosBanks.length) {
    // Return empty structures when there are no banks to process
    return {
      bankOraclePriceMap: new Map<string, OraclePrice>(),
    };
  }

  // Step 2: Prepare vote account mint tuples for staked collateral
  const voteAccMintTuples: [string, string][] = pythStakedCollateralBanks.map((bank) => [
    opts.validatorVoteAccountByBank?.[bank.address.toBase58()] ?? "",
    bank.mint.toBase58(),
  ]);

  // Step 3: Fetch Pyth price coefficients
  const priceCoeffByBank: Record<string, number> = {};

  // Native stake not supported
  // if (opts?.useApiEndpoint || !opts?.connection) {
  //   const { priceCoeffByBank: voteAccCoeffs } =
  //     await fetchPythStakedCollateralDataViaAPI(voteAccMintTuples);

  //   priceCoeffByBank = convertVoteAccCoeffsToBankCoeffs(
  //     pythStakedCollateralBanks,
  //     validatorVoteAccountByBank ?? {},
  //     voteAccCoeffs,
  //   );
  // } else {
  //   priceCoeffByBank = {};
  // }

  // Step 4: Extract oracle keys for price fetching
  const combinedPythBanks = [...pythPushBanks, ...pythPushKaminosBanks];
  const pythOracleKeys = extractPythOracleKeys(combinedPythBanks);

  // Filter for unique oracle keys to avoid duplicate fetches
  const uniquePythOracleKeys = Array.from(new Set(pythOracleKeys));

  // Step 5: Fetch oracle prices
  let oraclePrices: Record<string, OraclePrice>;
  if (opts.mode === "api") {
    oraclePrices = await fetchPythOraclePricesFromAPI(
      uniquePythOracleKeys,
      opts.pythOnchainData.endpoint,
      { queryKey: opts.pythOnchainData.queryKey }
    );
  } else {
    oraclePrices = await fetchPythOraclePricesFromChain(uniquePythOracleKeys, opts.connection);
  }

  // Step 6: Map banks to oracle prices
  const bankOraclePriceMap = mapPythBanksToOraclePrices(
    combinedPythBanks,
    pythStakedCollateralBanks,
    oraclePrices,
    priceCoeffByBank
  );

  return {
    bankOraclePriceMap,
  };
};

/**
 * Fetches Pyth oracle price data via internal API endpoint
 * @param pythOracleKeys - Array of Pyth oracle key strings
 * @param apiEndpoint - Fetches pyth oracle data with a GET request using the pyth keys as params
 * @returns Promise resolving to oracle prices indexed by oracle key
 */
export const fetchPythOraclePricesFromAPI = async (
  pythOracleKeys: string[],
  apiEndpoint: string,
  opts?: { queryKey?: string }
): Promise<Record<string, OraclePrice>> => {
  const queryKey = opts?.queryKey ?? "pythOracleKeys";
  const response = await fetch(`${apiEndpoint}?${queryKey}=${pythOracleKeys.join(",")}`);

  if (!response.ok) {
    throw new Error("Failed to fetch pyth oracle data");
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
        timestamp: oraclePrice.timestamp ? BigNumber(oraclePrice.timestamp) : null,
      },
    ])
  ) as Record<string, OraclePrice>;
};

/**
 * Fetches Pyth oracle data directly from the blockchain via RPC connection
 * @param requestedPythOracleKeys - Array of Pyth oracle key strings to fetch
 * @param connection - Solana RPC connection instance
 * @returns Promise resolving to oracle price data indexed by oracle key
 */
export const fetchPythOraclePricesFromChain = async (
  requestedPythOracleKeys: string[],
  connection: Connection
): Promise<Record<string, OraclePrice>> => {
  const updatedOraclePriceByKey: Record<string, OraclePrice> = {};
  const oracleAis = await chunkedGetRawMultipleAccountInfoOrdered(
    connection,
    requestedPythOracleKeys
  );

  for (const index in requestedPythOracleKeys) {
    const oracleKey = requestedPythOracleKeys[index]!;
    const priceDataRaw = oracleAis[index];

    let oraclePrice = priceDataRaw && parseRpcPythPriceData(priceDataRaw.data);

    if (!oraclePrice || oraclePrice.priceRealtime.price.eq(new BigNumber(0))) {
      oraclePrice = {
        ...oraclePrice,
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
        timestamp: new BigNumber(Date.now()),
      };
    }

    updatedOraclePriceByKey[oracleKey] = oraclePrice;
  }

  return updatedOraclePriceByKey;
};
