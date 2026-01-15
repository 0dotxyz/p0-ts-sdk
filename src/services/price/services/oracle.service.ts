import BigNumber from "bignumber.js";
import { PublicKey } from "@solana/web3.js";

import { BankType, RiskTier, OracleSetup } from "~/services/bank";
import { ZERO_ORACLE_KEY } from "~/constants";

import { OraclePrice } from "../types";

import {
  fetchPythOracleData,
  PythOracleServiceOpts,
} from "./pyth-oracle.service";
import { fetchSwbOracleData, SwbOracleServiceOpts } from "./swb-oracle.service";

/**
 * Fetches comprehensive oracle data from multiple providers (Pyth and Switchboard)
 * Implements intelligent routing based on oracle type and risk tier:
 * - Zero oracles: Returns 0 price immediately
 * - Isolated assets: Uses enriched bank price (no external calls)
 * - Collateral assets: Uses Pyth/Switchboard with Birdeye fallback
 *
 * @param banks - Array of bank objects
 * @param opts - Optional configuration including API endpoint usage, connection, and enriched banks
 * @returns Promise resolving to oracle price maps indexed by bank address and mint address
 */
export const fetchOracleData = async (
  banks: BankType[],
  opts: {
    pythOpts: PythOracleServiceOpts;
    swbOpts: SwbOracleServiceOpts;
    isolatedBanksOpts?: {
      fetchPrices: boolean;
      staticPricesByBank?: Record<string, number>;
    };
  }
): Promise<{
  bankOraclePriceMap: Map<string, OraclePrice>;
  mintOraclePriceMap: Map<string, OraclePrice>;
}> => {
  const {
    zeroOracleBanks,
    isolatedAssetBanks,
    collateralAssetBanks,
    fixedAssetBanks,
  } = classifyBanksForOracleStrategy(banks);

  // we don't fetch oracle data for zero oracle banks and use the enriched bank price for isolated assets
  const zeroResults = handleZeroOracleBanks(zeroOracleBanks);

  const fetchIsolatedPrice = opts?.isolatedBanksOpts?.fetchPrices ?? false;
  const isolatedResults = fetchIsolatedPrice
    ? handleIsolatedAssetBanks(
        isolatedAssetBanks,
        opts?.isolatedBanksOpts?.staticPricesByBank
      )
    : new Map();

  // handle fixed price assets
  const fixedResults = handleFixedOracleBanks(fixedAssetBanks);

  const assetBanks = [
    ...collateralAssetBanks,
    ...(fetchIsolatedPrice ? isolatedAssetBanks : []),
  ];

  // fetch oracle for asset banks
  const assetResults = await handleAssetBanks(assetBanks, {
    pythOpts: opts.pythOpts,
    swbOpts: opts.swbOpts,
  });

  return mergeOracleResults(
    [zeroResults, isolatedResults, assetResults, fixedResults],
    banks
  );
};

/**
 * Classifies banks based on their oracle setup and risk tier to determine pricing strategy
 * @param banks - Array of bank objects to classify
 * @returns Object containing arrays of banks categorized by pricing strategy
 */
function classifyBanksForOracleStrategy(banks: BankType[]): {
  zeroOracleBanks: BankType[];
  isolatedAssetBanks: BankType[];
  collateralAssetBanks: BankType[];
  fixedAssetBanks: BankType[];
} {
  const zeroOracleBanks: BankType[] = [];
  const isolatedAssetBanks: BankType[] = [];
  const collateralAssetBanks: BankType[] = [];
  const fixedAssetBanks: BankType[] = [];

  banks.forEach((bank) => {
    const hasZeroOracle = bank.config.oracleKeys.some((key) =>
      key.equals(new PublicKey(ZERO_ORACLE_KEY))
    );

    if (hasZeroOracle) {
      zeroOracleBanks.push(bank);
      return;
    }

    const isIsolatedAsset = bank.config.riskTier === RiskTier.Isolated;
    const isFixedAsset = bank.config.oracleSetup === OracleSetup.Fixed;

    if (isFixedAsset) {
      fixedAssetBanks.push(bank);
    } else if (isIsolatedAsset) {
      isolatedAssetBanks.push(bank);
    } else {
      collateralAssetBanks.push(bank);
    }
  });

  return {
    zeroOracleBanks,
    isolatedAssetBanks,
    collateralAssetBanks,
    fixedAssetBanks,
  };
}

function handleFixedOracleBanks(banks: BankType[]): Map<string, OraclePrice> {
  const oracleMap = new Map<string, OraclePrice>();

  banks.forEach((bank) => {
    const fixedPrice = bank.config.fixedPrice;

    const fixedOraclePrice: OraclePrice = {
      priceRealtime: {
        price: fixedPrice,
        confidence: BigNumber(0),
        lowestPrice: fixedPrice,
        highestPrice: fixedPrice,
      },
      priceWeighted: {
        price: fixedPrice,
        confidence: BigNumber(0),
        lowestPrice: fixedPrice,
        highestPrice: fixedPrice,
      },
      timestamp: BigNumber(Date.now()),
    };

    oracleMap.set(bank.address.toBase58(), fixedOraclePrice);
  });

  return oracleMap;
}

/**
 * Handles banks with zero oracles by returning zero prices
 * @param banks - Array of zero oracle banks
 * @returns Map of bank addresses to zero oracle prices
 */
function handleZeroOracleBanks(banks: BankType[]): Map<string, OraclePrice> {
  const oracleMap = new Map<string, OraclePrice>();

  banks.forEach((bank) => {
    const zeroOraclePrice: OraclePrice = {
      priceRealtime: {
        price: BigNumber(0),
        confidence: BigNumber(0),
        lowestPrice: BigNumber(0),
        highestPrice: BigNumber(0),
      },
      priceWeighted: {
        price: BigNumber(0),
        confidence: BigNumber(0),
        lowestPrice: BigNumber(0),
        highestPrice: BigNumber(0),
      },
      timestamp: BigNumber(Date.now()),
    };

    oracleMap.set(bank.address.toBase58(), zeroOraclePrice);
  });

  return oracleMap;
}

/**
 * Handles isolated asset banks by using static prices
 * @param banks - Array of isolated asset banks
 * @param staticPrices - Optional static prices for isolated assets
 * @returns Map of bank addresses to oracle prices derived from static prices
 */
function handleIsolatedAssetBanks(
  banks: BankType[],
  staticPrices?: Record<string, number>
): Map<string, OraclePrice> {
  const oracleMap = new Map<string, OraclePrice>();

  banks.forEach((bank) => {
    const price = staticPrices?.[bank.address.toBase58()] ?? 0;

    const oraclePrice: OraclePrice = {
      priceRealtime: {
        price: BigNumber(price),
        confidence: BigNumber(0),
        lowestPrice: BigNumber(price),
        highestPrice: BigNumber(price),
      },
      priceWeighted: {
        price: BigNumber(price),
        confidence: BigNumber(0),
        lowestPrice: BigNumber(price),
        highestPrice: BigNumber(price),
      },
      timestamp: BigNumber(Date.now()),
    };

    oracleMap.set(bank.address.toBase58(), oraclePrice);
  });

  return oracleMap;
}

/**
 * Handles banks using existing oracle infrastructure (Pyth + Switchboard + Birdeye fallback)
 * @param banks - Array of banks
 * @param opts - Optional configuration
 * @returns Map of bank addresses to oracle prices from external oracle providers
 */
async function handleAssetBanks(
  banks: BankType[],
  opts: { pythOpts: PythOracleServiceOpts; swbOpts: SwbOracleServiceOpts }
): Promise<Map<string, OraclePrice>> {
  if (banks.length === 0) {
    return new Map<string, OraclePrice>();
  }

  const [pythData, swbData] = await Promise.all([
    fetchPythOracleData(banks, opts.pythOpts),
    fetchSwbOracleData(banks, opts.swbOpts),
  ]);

  const bankOraclePriceMap = new Map<string, OraclePrice>();

  // Map pyth data
  pythData.bankOraclePriceMap.forEach((oraclePrice, bankAddress) => {
    bankOraclePriceMap.set(bankAddress, oraclePrice);
  });

  // Map swb data
  swbData.bankOraclePriceMap.forEach((oraclePrice, bankAddress) => {
    bankOraclePriceMap.set(bankAddress, oraclePrice);
  });

  // Check for any missing oracle prices and set to zero as fallback
  banks.forEach((bank) => {
    const bankAddress = bank.address.toBase58();
    const oraclePrice = bankOraclePriceMap.get(bankAddress);
    if (!oraclePrice) {
      bankOraclePriceMap.set(bankAddress, {
        priceRealtime: {
          price: BigNumber(0),
          confidence: BigNumber(0),
          lowestPrice: BigNumber(0),
          highestPrice: BigNumber(0),
        },
        priceWeighted: {
          price: BigNumber(0),
          confidence: BigNumber(0),
          lowestPrice: BigNumber(0),
          highestPrice: BigNumber(0),
        },
        timestamp: BigNumber(Date.now()),
      });
    }
  });

  return bankOraclePriceMap;
}

/**
 * Merges oracle results from different strategies and builds mint-based oracle map
 * @param results - Array of oracle price maps from different strategies
 * @param allBanks - All banks for mint mapping
 * @returns Combined oracle price maps indexed by bank address and mint address
 */
function mergeOracleResults(
  results: Map<string, OraclePrice>[],
  allBanks: BankType[]
): {
  bankOraclePriceMap: Map<string, OraclePrice>;
  mintOraclePriceMap: Map<string, OraclePrice>;
} {
  const bankOraclePriceMap = new Map<string, OraclePrice>();
  const mintOraclePriceMap = new Map<string, OraclePrice>();

  // Merge all oracle price maps
  results.forEach((resultMap) => {
    resultMap.forEach((oraclePrice, bankAddress) => {
      bankOraclePriceMap.set(bankAddress, oraclePrice);
    });
  });

  // Build mint-based oracle map
  allBanks.forEach((bank) => {
    const bankAddress = bank.address.toBase58();
    const oraclePrice = bankOraclePriceMap.get(bankAddress);
    if (oraclePrice) {
      const mintAddress = bank.mint.toBase58();
      mintOraclePriceMap.set(mintAddress, oraclePrice);
    }
  });

  return {
    bankOraclePriceMap,
    mintOraclePriceMap,
  };
}
