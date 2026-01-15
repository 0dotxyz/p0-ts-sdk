import BigNumber from "bignumber.js";

export interface PriceWithConfidence {
  price: BigNumber;
  confidence: BigNumber;
  lowestPrice: BigNumber;
  highestPrice: BigNumber;
}

export interface OraclePrice {
  priceRealtime: PriceWithConfidence;
  priceWeighted: PriceWithConfidence;
  timestamp: BigNumber;
  switchboardData?: {
    queue: string;
    feedHash: string;
    maxVariance: string;
    minResponses: number;
    rawPrice: string;
    stdev: string;
  };
}

export enum PriceBias {
  Lowest = 0,
  None = 1,
  Highest = 2,
}

export interface PriceWithConfidenceDto {
  price: string;
  confidence: string;
  lowestPrice: string;
  highestPrice: string;
}

export interface OraclePriceDto {
  priceRealtime: PriceWithConfidenceDto;
  priceWeighted: PriceWithConfidenceDto;
  timestamp: string;
  switchboardData?: {
    queue: string;
    feedHash: string;
    maxVariance: string;
    minResponses: number;
    rawPrice: string;
    stdev: string;
  };
}
