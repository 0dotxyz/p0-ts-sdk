import { PublicKey } from "@solana/web3.js";
import BigNumber from "bignumber.js";

import {
  PYTH_PRICE_CONF_INTERVALS,
  MAX_CONFIDENCE_INTERVAL_RATIO,
} from "~/constants";
import { BankType, OracleSetup } from "~/services/bank";
import { parsePriceInfo } from "~/vendor/pyth_push_oracle";

import { OraclePrice, PriceWithConfidence } from "../types";

/**
 * Categorizes banks by their oracle setup type into legacy, push, and staked collateral banks
 * @param banks - Array of bank objects
 * @returns Object containing categorized banks by oracle type
 *   - pythLegacyBanks: Banks using deprecated Pyth legacy oracles
 *   - pythPushBanks: Banks using Pyth push oracles
 *   - pythStakedCollateralBanks: Banks using staked collateral with Pyth push oracles
 */
export const categorizePythBanks = (
  banks: BankType[]
) => {
  // Depracated
  const pythLegacyBanks = banks.filter(
    (bank) => bank.config.oracleSetup === OracleSetup.PythLegacy
  );

  // Pyth push oracle banks
  const pythPushBanks = banks.filter(
    (bank) => bank.config.oracleSetup === OracleSetup.PythPushOracle
  );

  // Staked collateral pyth banks (all have sol oracle)
  const pythStakedCollateralBanks = banks.filter(
    (bank) => bank.config.oracleSetup === OracleSetup.StakedWithPythPush
  );

  // Pyth push kaminos banks
  const pythPushKaminosBanks = banks.filter(
    (bank) => bank.config.oracleSetup === OracleSetup.KaminoPythPush
  );

  return {
    pythLegacyBanks,
    pythPushBanks,
    pythStakedCollateralBanks,
    pythPushKaminosBanks,
  };
};

/**
 * Converts vote account coefficients to bank address coefficients for staked collateral pricing
 * @param pythStakedCollateralBanks - Array of staked collateral banks
 * @param validatorVoteAccountByBank - Mapping of bank addresses to validator vote accounts
 * @param voteAccCoeffs - Price coefficients indexed by vote account addresses
 * @returns Record mapping bank addresses to their corresponding price coefficients
 */
export const convertVoteAccCoeffsToBankCoeffs = (
  pythStakedCollateralBanks: BankType[],
  validatorVoteAccountByBank: {
    [address: string]: string;
  },
  voteAccCoeffs: Record<string, number>
): Record<string, number> => {
  const priceCoeffByBank: Record<string, number> = {};

  pythStakedCollateralBanks.forEach((bank) => {
    const voteAccount = validatorVoteAccountByBank[bank.address.toBase58()];
    if (voteAccount && voteAccCoeffs[voteAccount] !== undefined) {
      priceCoeffByBank[bank.address.toBase58()] = voteAccCoeffs[voteAccount];
    }
  });

  return priceCoeffByBank;
};

/**
 * Extracts oracle keys from Pyth banks for price data fetching
 * @param pythBanks - Array of Pyth bank objects
 * @returns Array of oracle key strings in base58 format
 */
export const extractPythOracleKeys = (
  pythBanks: BankType[]
): string[] => {
  const keys = pythBanks.map((bank) =>
    bank.config.oracleKeys[0]!.toBase58()
  );

  return [...keys];
};

/**
 * Maps banks to their corresponding oracle prices with optional price coefficient adjustments
 * @param pythPushBanks - Array of Pyth push oracle banks
 * @param pythStakedCollateralBanks - Array of staked collateral banks requiring price adjustments
 * @param oraclePrices - Record of oracle prices indexed by oracle key
 * @param priceCoeffByBank - Price coefficients for staked collateral banks
 * @returns Map of bank addresses to their corresponding oracle prices
 */
export const mapPythBanksToOraclePrices = (
  pythPushBanks: BankType[],
  pythStakedCollateralBanks: BankType[],
  oraclePrices: Record<string, OraclePrice>,
  priceCoeffByBank: Record<string, number>
): Map<string, OraclePrice> => {
  const bankOraclePriceMap = new Map<string, OraclePrice>();

  // Map banks
  pythPushBanks.forEach((bank) => {
    const oracleKey = bank.config.oracleKeys[0]!.toBase58();
    const oraclePrice = oraclePrices[oracleKey];
    if (oraclePrice) {
      bankOraclePriceMap.set(bank.address.toBase58(), oraclePrice);
    }
  });

  // Map staked collateral banks with price coefficient adjustment
  pythStakedCollateralBanks.forEach((bank) => {
    const priceCoeff = priceCoeffByBank[bank.address.toBase58()];
    const oracleKey = bank.config.oracleKeys[0]?.toBase58();

    if (oracleKey && priceCoeff !== undefined) {
      const oraclePrice = oraclePrices[oracleKey];
      if (oraclePrice) {
        bankOraclePriceMap.set(bank.address.toBase58(), {
          timestamp: oraclePrice.timestamp,
          priceRealtime: adjustPriceComponent(
            oraclePrice.priceRealtime,
            priceCoeff
          ),
          priceWeighted: adjustPriceComponent(
            oraclePrice.priceWeighted,
            priceCoeff
          ),
        });
      }
    }
  });

  return bankOraclePriceMap;
};

/**
 * Adjusts price component values by multiplying with a price coefficient
 * @param priceComponent - Price component containing price, confidence, and bounds
 * @param priceCoeff - Multiplier coefficient to adjust the price values
 * @returns Adjusted price component with multiplied price and bounds
 */
export const adjustPriceComponent = (
  priceComponent: PriceWithConfidence,
  priceCoeff: number
) => ({
  price: priceComponent.price.multipliedBy(priceCoeff),
  confidence: priceComponent.confidence,
  lowestPrice: priceComponent.lowestPrice.multipliedBy(priceCoeff),
  highestPrice: priceComponent.highestPrice.multipliedBy(priceCoeff),
});

/**
 * Parses raw Pyth price data from RPC into standardized OraclePriceDto format
 * @param rawData - Raw buffer data from Pyth price account
 * @returns Parsed oracle price data with realtime and weighted price information
 */
export function parseRpcPythPriceData(rawData: Buffer): OraclePrice {
  function capConfidenceInterval(
    price: BigNumber,
    confidence: BigNumber,
    maxConfidence: BigNumber
  ): BigNumber {
    const maxConfidenceInterval = price.times(maxConfidence);

    return BigNumber.min(confidence, maxConfidenceInterval);
  }

  const bytesWithoutDiscriminator = rawData.slice(8);
  const data = parsePriceInfo(bytesWithoutDiscriminator);

  const exponent = new BigNumber(10 ** data.priceMessage.exponent);

  const priceRealTime = new BigNumber(Number(data.priceMessage.price)).times(
    exponent
  );
  const confidenceRealTime = new BigNumber(Number(data.priceMessage.conf))
    .times(exponent)
    .times(PYTH_PRICE_CONF_INTERVALS);
  const cappedConfidenceRealTime = capConfidenceInterval(
    priceRealTime,
    confidenceRealTime,
    MAX_CONFIDENCE_INTERVAL_RATIO
  );
  const lowestPriceRealTime = priceRealTime.minus(cappedConfidenceRealTime);
  const highestPriceRealTime = priceRealTime.plus(cappedConfidenceRealTime);

  const priceTimeWeighted = new BigNumber(
    Number(data.priceMessage.emaPrice)
  ).times(exponent);
  const confidenceTimeWeighted = new BigNumber(
    Number(data.priceMessage.emaConf)
  )
    .times(exponent)
    .times(PYTH_PRICE_CONF_INTERVALS);
  const cappedConfidenceWeighted = capConfidenceInterval(
    priceTimeWeighted,
    confidenceTimeWeighted,
    MAX_CONFIDENCE_INTERVAL_RATIO
  );
  const lowestPriceWeighted = priceTimeWeighted.minus(cappedConfidenceWeighted);
  const highestPriceWeighted = priceTimeWeighted.plus(cappedConfidenceWeighted);

  return {
    priceRealtime: {
      price: priceRealTime,
      confidence: cappedConfidenceRealTime,
      lowestPrice: lowestPriceRealTime,
      highestPrice: highestPriceRealTime,
    },
    priceWeighted: {
      price: priceTimeWeighted,
      confidence: cappedConfidenceWeighted,
      lowestPrice: lowestPriceWeighted,
      highestPrice: highestPriceWeighted,
    },
    timestamp: new BigNumber(Number(data.priceMessage.publishTime)),
  };
}
