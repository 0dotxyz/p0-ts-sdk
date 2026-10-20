import { BigNumber } from "bignumber.js";

export interface PriceWithConfidence {
  price: BigNumber;
  confidence: BigNumber;
  lowestPrice: BigNumber;
  highestPrice: BigNumber;
}

export interface OraclePrice {
  priceRealtime: PriceWithConfidence;
  priceWeighted: PriceWithConfidence;
  /** Unix seconds the price was published at; for a price the SDK makes up, when it was made */
  timestamp: BigNumber;
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
}
