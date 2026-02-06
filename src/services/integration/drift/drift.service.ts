import { Connection, PublicKey } from "@solana/web3.js";

import { Bank } from "~/models/bank";
import { AssetTag } from "~/services/bank";
import { chunkedGetRawMultipleAccountInfoOrderedWithNulls } from "~/services/misc";
import {
  DriftSpotMarket,
  DriftUser,
  DriftRewards,
  decodeDriftSpotMarketData,
  decodeDriftUserData,
  getAllRequiredMarkets,
  getDriftRewards,
  driftSpotMarketRawToDto,
  driftUserRawToDto,
  driftRewardsRawToDto,
  dtoToDriftSpotMarketRaw,
  dtoToDriftUserRaw,
  dtoToDriftRewardsRaw,
} from "~/vendor/drift";

import { DriftStateJsonByBank } from "./drift.types";

export interface DriftMetadata {
  driftStates: {
    driftSpotMarketState: DriftSpotMarket;
    driftUserState: DriftUser;
    driftUserRewards: DriftRewards[];
  };
}

export interface FetchDriftMetadataOptions {
  connection: Connection;
  banks: Bank[];
}

export interface DriftBankInput {
  bankAddress: string;
  spotMarket: string;
  user: string;
  userStats: string;
}

/**
 * Fetch Drift spot market, user, and rewards states for banks with Drift integration
 *
 * This function:
 * 1. Filters banks that have Drift integration accounts
 * 2. Batch fetches all spot market, user, and userStats data in one RPC call
 * 3. Decodes spot market and user states
 * 4. Fetches all required markets for reward calculation
 * 5. Calculates rewards for all banks
 * 6. Returns a complete map keyed by bank address
 *
 * @param options - Connection and banks to fetch metadata for
 * @returns Map of bank addresses to their complete Drift metadata (spot market, user, rewards)
 */
export async function getDriftMetadata(
  options: FetchDriftMetadataOptions
): Promise<Map<string, DriftMetadata>> {
  const driftBanks = options.banks.filter((b) => b.config.assetTag === AssetTag.DRIFT);
  const DEFAULT_PUBKEY = PublicKey.default;

  const driftBankInputs: DriftBankInput[] = driftBanks
    .map((bank) => {
      const accounts = bank.driftIntegrationAccounts;
      if (!accounts) {
        console.warn("Drift data not found for bank: ", bank.address.toBase58());
        return null;
      }
      const spotMarketKey = accounts.driftSpotMarket;
      const userKey = accounts.driftUser;
      const userStatsKey = accounts.driftUserStats;
      if (
        spotMarketKey.equals(DEFAULT_PUBKEY) ||
        userKey.equals(DEFAULT_PUBKEY) ||
        userStatsKey.equals(DEFAULT_PUBKEY)
      ) {
        return null;
      }
      return {
        bankAddress: bank.address.toBase58(),
        spotMarket: spotMarketKey.toBase58(),
        user: userKey.toBase58(),
        userStats: userStatsKey.toBase58(),
      };
    })
    .filter((b): b is DriftBankInput => b !== null);

  const driftStates = await getDriftStatesDto(options.connection, driftBankInputs);

  const driftMetadataMap = new Map<string, DriftMetadata>();
  for (const [bankAddress, state] of Object.entries(driftStates)) {
    driftMetadataMap.set(bankAddress, {
      driftStates: {
        driftSpotMarketState: dtoToDriftSpotMarketRaw(state.driftSpotMarketState),
        driftUserState: dtoToDriftUserRaw(state.driftUserState),
        driftUserRewards: state.driftUserRewards.map((r) => dtoToDriftRewardsRaw(r)),
      },
    });
  }

  return driftMetadataMap;
}

export async function getDriftStatesDto(
  connection: Connection,
  driftBanks: DriftBankInput[]
): Promise<DriftStateJsonByBank> {
  const DEFAULT_PUBKEY = PublicKey.default;
  const DEFAULT_PUBKEY_BASE = DEFAULT_PUBKEY.toBase58();

  const rawDriftStatesMap: Record<
    string,
    {
      driftSpotMarketState: DriftSpotMarket;
      driftUserState: DriftUser;
    }
  > = {};

  // Filter banks with valid (non-default) keys
  const validBanks = driftBanks.filter(
    (bank) =>
      bank.spotMarket !== DEFAULT_PUBKEY_BASE &&
      bank.user !== DEFAULT_PUBKEY_BASE &&
      bank.userStats !== DEFAULT_PUBKEY_BASE
  );

  // Early return if no valid banks
  if (validBanks.length === 0) {
    return {};
  }

  // Flatten all keys for batch fetching (triplets: spotMarket, user, userStats)
  const allKeys: string[] = validBanks.flatMap((bank) => [
    bank.spotMarket,
    bank.user,
    bank.userStats,
  ]);

  const allResults = await chunkedGetRawMultipleAccountInfoOrderedWithNulls(connection, allKeys);

  const allBankMarkets: DriftSpotMarket[] = [];
  const allDriftUsers: DriftUser[] = [];

  // Process results - they come in triplets (spotMarket, user, userStats)
  for (const [index, bank] of validBanks.entries()) {
    const driftSpotMarketAccount = allResults[index * 3];
    const driftUserAccount = allResults[index * 3 + 1];
    const driftUserStatsAccount = allResults[index * 3 + 2];

    if (!driftSpotMarketAccount || !driftUserAccount || !driftUserStatsAccount) {
      continue;
    }

    const driftSpotMarketState = decodeDriftSpotMarketData(driftSpotMarketAccount.data);
    const driftUserState = decodeDriftUserData(driftUserAccount.data);

    allBankMarkets.push(driftSpotMarketState);
    allDriftUsers.push(driftUserState);

    rawDriftStatesMap[bank.bankAddress] = {
      driftSpotMarketState,
      driftUserState,
    };
  }

  // Get all required markets for reward calculation
  const allMarkets = await getAllRequiredMarkets(allBankMarkets, allDriftUsers, connection);

  // Prepare user states for reward calculation
  const userStates = Object.entries(rawDriftStatesMap).map(([bankKey, driftStates]) => ({
    bankAddress: new PublicKey(bankKey),
    marketMint: driftStates.driftSpotMarketState.mint,
    driftUser: driftStates.driftUserState,
  }));

  // Calculate rewards for all banks
  const driftRewardsByBank = await getDriftRewards(allMarkets, userStates, connection);

  // Convert raw states to DTO format and attach rewards
  const driftStatesMap: DriftStateJsonByBank = Object.entries(rawDriftStatesMap).reduce(
    (acc, [bankKey, driftStates]) => {
      const rewards = driftRewardsByBank.get(bankKey) || [];

      acc[bankKey] = {
        driftSpotMarketState: driftSpotMarketRawToDto(driftStates.driftSpotMarketState),
        driftUserState: driftUserRawToDto(driftStates.driftUserState),
        driftUserRewards: rewards.map((r) => driftRewardsRawToDto(r)),
      };

      return acc;
    },
    {} as DriftStateJsonByBank
  );

  return driftStatesMap;
}
