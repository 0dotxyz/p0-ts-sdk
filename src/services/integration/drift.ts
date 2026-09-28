import type { Address, GetMultipleAccountsApi, Rpc } from "@solana/kit";
import { BigNumber } from "bignumber.js";

import { DEFAULT_ADDRESS } from "~/constants";
import { chunkedGetRawMultipleAccountInfoOrderedWithNulls } from "~/services/misc";
import {
  decodeDriftSpotMarket,
  decodeDriftUser,
  driftRewardsRawToDto,
  driftSpotMarketRawToDto,
  driftUserRawToDto,
  getAllRequiredMarkets,
  getDriftRewards,
  type DriftRewards,
  type DriftRewardsJSON,
  type DriftSpotMarket,
  type DriftSpotMarketJSON,
  type DriftUser,
  type DriftUserJSON,
} from "~/vendor/drift";

export interface DriftBankInput {
  bankAddress: Address;
  spotMarket: Address;
  user: Address;
  userStats: Address;
}

export type DriftStateByBank = Record<
  string,
  { spotMarketState: DriftSpotMarket; userState: DriftUser; userRewards: DriftRewards[] }
>;

export type DriftStateJsonByBank = Record<
  string,
  {
    driftSpotMarketState: DriftSpotMarketJSON;
    driftUserState: DriftUserJSON;
    driftUserRewards: DriftRewardsJSON[];
  }
>;

/**
 * Fetches each bank's Drift spot market and user, plus the rewards credited to that user, keyed by
 * bank address. Reward markets not among the banks' markets are fetched too. Banks with a default
 * spot market, user or user-stats address, or a missing account, are left out.
 */
export async function fetchDriftStates(
  rpc: Rpc<GetMultipleAccountsApi>,
  banks: DriftBankInput[]
): Promise<DriftStateByBank> {
  const validBanks = banks.filter(
    (bank) =>
      bank.spotMarket !== DEFAULT_ADDRESS &&
      bank.user !== DEFAULT_ADDRESS &&
      bank.userStats !== DEFAULT_ADDRESS
  );
  const accounts = await chunkedGetRawMultipleAccountInfoOrderedWithNulls(
    rpc,
    validBanks.flatMap((bank) => [bank.spotMarket, bank.user, bank.userStats])
  );

  const decoded = validBanks.flatMap((bank, i) => {
    const [spotMarket, user, userStats] = accounts.slice(3 * i, 3 * i + 3);
    return spotMarket && user && userStats
      ? [
          {
            bankAddress: bank.bankAddress,
            spotMarketState: decodeDriftSpotMarket(spotMarket.data),
            userState: decodeDriftUser(user.data),
          },
        ]
      : [];
  });

  const markets = await getAllRequiredMarkets(
    rpc,
    decoded.map((state) => state.spotMarketState),
    decoded.map((state) => state.userState)
  );
  const rewards = await getDriftRewards(
    rpc,
    markets,
    decoded.map((state) => ({
      bankAddress: state.bankAddress,
      marketMint: state.spotMarketState.mint,
      driftUser: state.userState,
    }))
  );

  return Object.fromEntries(
    decoded.map(({ bankAddress, spotMarketState, userState }) => [
      bankAddress,
      { spotMarketState, userState, userRewards: rewards.get(bankAddress) ?? [] },
    ])
  );
}

/** {@link fetchDriftStates} in the JSON wire format served by API routes. */
export async function getDriftStatesDto(
  rpc: Rpc<GetMultipleAccountsApi>,
  banks: DriftBankInput[]
): Promise<DriftStateJsonByBank> {
  const states = await fetchDriftStates(rpc, banks);
  return Object.fromEntries(
    Object.entries(states).map(([bank, { spotMarketState, userState, userRewards }]) => [
      bank,
      {
        driftSpotMarketState: driftSpotMarketRawToDto(spotMarketState),
        driftUserState: driftUserRawToDto(userState),
        driftUserRewards: userRewards.map(driftRewardsRawToDto),
      },
    ])
  );
}

/** Underlying tokens per Drift spot-balance unit of `spotMarket` (its cumulative deposit interest). */
export function getDriftCTokenMultiplier(spotMarket: DriftSpotMarket): BigNumber {
  return new BigNumber(spotMarket.cumulativeDepositInterest.toString()).dividedBy(
    new BigNumber(10).pow(19 - spotMarket.decimals)
  );
}
