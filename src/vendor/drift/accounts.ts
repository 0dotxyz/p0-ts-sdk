import type { ReadonlyUint8Array } from "@solana/kit";

import { decodeAccountData } from "../account-data";

import type { DriftSpotMarket, DriftUser, DriftUserStats } from "./types";

import {
  getSpotMarketDecoder,
  getUserDecoder,
  getUserStatsDecoder,
  SPOT_MARKET_DISCRIMINATOR,
  USER_DISCRIMINATOR,
  USER_STATS_DISCRIMINATOR,
} from "~/generated/drift";

export { DRIFT_PROGRAM_ADDRESS, SpotBalanceType } from "~/generated/drift";

/**
 * Decodes a Drift `SpotMarket` account.
 * @throws if the discriminator doesn't match
 */
export function decodeDriftSpotMarket(data: ReadonlyUint8Array): DriftSpotMarket {
  return decodeAccountData(
    data,
    SPOT_MARKET_DISCRIMINATOR,
    getSpotMarketDecoder(),
    "Drift SpotMarket"
  );
}

/**
 * Decodes a Drift `User` account.
 * @throws if the discriminator doesn't match
 */
export function decodeDriftUser(data: ReadonlyUint8Array): DriftUser {
  return decodeAccountData(data, USER_DISCRIMINATOR, getUserDecoder(), "Drift User");
}

/**
 * Decodes a Drift `UserStats` account.
 * @throws if the discriminator doesn't match
 */
export function decodeDriftUserStats(data: ReadonlyUint8Array): DriftUserStats {
  return decodeAccountData(
    data,
    USER_STATS_DISCRIMINATOR,
    getUserStatsDecoder(),
    "Drift UserStats"
  );
}
