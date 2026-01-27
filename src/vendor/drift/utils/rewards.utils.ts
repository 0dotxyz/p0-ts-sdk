import { PublicKey, Connection } from "@solana/web3.js";

import { USDC_MINT } from "~/constants";

import {
  DriftUser,
  DriftRewards,
  DriftSpotMarket,
  DriftSpotMarketRaw,
  SpotPosition,
} from "../types";

import { deriveDriftSpotMarket } from "./derive.utils";
import { decodeDriftSpotMarketData } from "./deserialize.utils";

/*
 *   Drift rewards get distributed to users in the form of spot positions.
 *   The spotPositions array in the DriftUser struct is an array of all the spot positions a user has.
 *   The first two positions are always [USDC, token]. The rest are the rewards
 *   (unless if bank is USDC then it's [USDC, ...rewards])
 *
 *   This function returns the rewards for each bank
 *
 *   NOTE: if bank has more then 2 Drift rewards, program will brick
 */
export async function getDriftRewards(
  spotMarkets: DriftSpotMarket[],
  userStates: {
    bankAddress: PublicKey;
    marketMint: PublicKey;
    driftUser: DriftUser;
  }[],
  connection: Connection
) {
  // Not all rewards will be in spot markets we have fetched, so need to fetch seperately
  let missingMarketIndexes: Set<number> = new Set();

  const spotMarketsMap = new Map(spotMarkets.map((market) => [market.marketIndex, market]));

  // Get all active rewards
  const userStatesWithRewards = userStates.map((userState) => {
    const spotPositions = userState.driftUser.spotPositions;
    const isUsdc = userState.marketMint.equals(USDC_MINT);
    const spotPositionsLength = spotPositions.length;
    const rewardIndex = isUsdc ? 1 : 2;
    const rewards: SpotPosition[] = spotPositions
      .slice(rewardIndex)
      .filter((p) => p.marketIndex !== 0);

    if (rewards.length > 0) {
      rewards.forEach((reward) => {
        const index = reward.marketIndex;
        const market = spotMarketsMap.get(index);
        if (!market) {
          missingMarketIndexes.add(index);
        }
      });
    }

    return {
      userState,
      rewards,
    };
  });

  const missingMarketIndexesArray = Array.from(missingMarketIndexes);

  const missingMarketKeys = missingMarketIndexesArray.map(
    (index) => deriveDriftSpotMarket(index)[0]
  );

  // Fetch missing markets
  const missingMarketsAccounts = missingMarketKeys.length
    ? await connection.getMultipleAccountsInfo(missingMarketKeys)
    : [];

  // Any console error here should not be ignored and indicate something seriously wrong
  const missingMarketsMap: Map<number, DriftSpotMarketRaw> = new Map([
    // Include all existing spot markets
    ...spotMarkets.map((market) => [market.marketIndex, market] as [number, DriftSpotMarketRaw]),
    // Add newly fetched missing markets
    ...missingMarketsAccounts
      .map((account, idx) => {
        const marketIndex = missingMarketIndexesArray[idx];

        if (!marketIndex) {
          console.error("Missing market index, for ", marketIndex);
          return null;
        }

        if (!account) {
          console.error("Missing market account, for ", missingMarketKeys[idx]?.toBase58());
          return null;
        } else {
          const decodedMarket = decodeDriftSpotMarketData(account.data);
          return [marketIndex, decodedMarket];
        }
      })
      .filter((market): market is [number, DriftSpotMarketRaw] => market !== null),
  ]);

  // Formats the rewards by bank
  const driftRewardsByBank = new Map(
    userStatesWithRewards.map((userStateWithRewards) => {
      const { userState, rewards } = userStateWithRewards;
      const driftRewards: DriftRewards[] = [];
      rewards.forEach((reward) => {
        const marketIndex = reward.marketIndex;
        const market = missingMarketsMap.get(marketIndex);
        if (!market) {
          console.error("Missing market, for ", marketIndex);
        } else {
          driftRewards.push({
            oracle: market.oracle,
            marketIndex,
            spotMarket: deriveDriftSpotMarket(marketIndex)[0],
            mint: market.mint,
            spotPosition: reward,
          });
        }
      });
      return [userState.bankAddress.toBase58(), driftRewards];
    })
  );

  return driftRewardsByBank;
}

export async function getAllRequiredMarkets(
  spotMarkets: DriftSpotMarket[],
  driftUsers: DriftUser[],
  connection: Connection
): Promise<DriftSpotMarketRaw[]> {
  const allKeys = driftUsers.map((user) =>
    user.spotPositions.map((position) => position.marketIndex)
  );

  const allKeysFlattened = new Set(allKeys.flat());

  const missingMarketIndexes = Array.from(allKeysFlattened).filter(
    (index) => !spotMarkets.some((market) => market.marketIndex === index)
  );

  const missingMarketKeys = missingMarketIndexes.map((index) => deriveDriftSpotMarket(index)[0]);

  const missingMarketsAccounts = missingMarketKeys.length
    ? await connection.getMultipleAccountsInfo(missingMarketKeys)
    : [];

  // Use a Map internally to deduplicate by marketIndex
  const allMarketsMap: Map<number, DriftSpotMarketRaw> = new Map([
    // Include all existing spot markets
    ...spotMarkets.map((market) => [market.marketIndex, market] as [number, DriftSpotMarketRaw]),
    // Add newly fetched missing markets
    ...missingMarketsAccounts
      .map((account, idx) => {
        const marketIndex = missingMarketIndexes[idx];

        if (!marketIndex) {
          console.error("Missing market index, for ", marketIndex);
          return null;
        }

        if (!account) {
          console.error("Missing market account, for ", missingMarketKeys[idx]?.toBase58());
          return null;
        } else {
          const decodedMarket = decodeDriftSpotMarketData(account.data);
          return [marketIndex, decodedMarket];
        }
      })
      .filter((market): market is [number, DriftSpotMarketRaw] => market !== null),
  ]);

  return Array.from(allMarketsMap.values());
}
