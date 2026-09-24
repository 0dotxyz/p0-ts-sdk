import type { ReadonlyUint8Array } from "@solana/kit";

import { decodeAccountData } from "../account-data";

import {
  getSpotMarketDecoder,
  getUserDecoder,
  getUserStatsDecoder,
  SPOT_MARKET_DISCRIMINATOR,
  USER_DISCRIMINATOR,
  USER_STATS_DISCRIMINATOR,
  type SpotMarket,
  type User,
  type UserStats,
} from "~/generated/drift";

export { DRIFT_PROGRAM_ADDRESS, SpotBalanceType } from "~/generated/drift";

/**
 * Decodes a Drift `SpotMarket` account; the result satisfies `DriftSpotMarket`.
 * @throws if the discriminator doesn't match
 */
export function decodeDriftSpotMarket(data: ReadonlyUint8Array): SpotMarket {
  return decodeAccountData(
    data,
    SPOT_MARKET_DISCRIMINATOR,
    getSpotMarketDecoder(),
    "Drift SpotMarket"
  );
}

/**
 * Decodes a Drift `User` account; the result satisfies `DriftUser`.
 * @throws if the discriminator doesn't match
 */
export function decodeDriftUser(data: ReadonlyUint8Array): User {
  return decodeAccountData(data, USER_DISCRIMINATOR, getUserDecoder(), "Drift User");
}

/**
 * Decodes a Drift `UserStats` account; the result satisfies `DriftUserStats`.
 * @throws if the discriminator doesn't match
 */
export function decodeDriftUserStats(data: ReadonlyUint8Array): UserStats {
  return decodeAccountData(
    data,
    USER_STATS_DISCRIMINATOR,
    getUserStatsDecoder(),
    "Drift UserStats"
  );
}
