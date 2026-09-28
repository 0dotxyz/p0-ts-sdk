import type { GetMultipleAccountsApi, Rpc } from "@solana/kit";

import { decodeDriftSpotMarket, decodeDriftUser } from "./accounts";
import { getAllRequiredMarkets, getDriftRewards } from "./rewards";
import { driftRewardsRawToDto, driftSpotMarketRawToDto, driftUserRawToDto } from "./serialize";
import type { DriftBankInput, DriftStates, DriftStatesJSON } from "./types";

import { DEFAULT_ADDRESS } from "~/constants";
import { chunkedGetRawMultipleAccountInfoOrderedWithNulls } from "~/utils";

/**
 * Fetches each bank's {@link DriftStates}, keyed by bank address. Reward markets not among the
 * banks' markets are fetched too. Banks with a default venue address or a missing spot market or
 * user are left out.
 * @throws if a fetched account isn't the Drift account it should be
 */
export async function fetchDriftStates(
  rpc: Rpc<GetMultipleAccountsApi>,
  banks: DriftBankInput[]
): Promise<Record<string, DriftStates>> {
  const validBanks = banks.filter(
    (bank) => bank.spotMarket !== DEFAULT_ADDRESS && bank.user !== DEFAULT_ADDRESS
  );
  const accounts = await chunkedGetRawMultipleAccountInfoOrderedWithNulls(
    rpc,
    validBanks.flatMap((bank) => [bank.spotMarket, bank.user])
  );
  const decoded = validBanks.flatMap((bank, i) => {
    const [spotMarket, user] = accounts.slice(2 * i, 2 * i + 2);
    return spotMarket && user
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
    decoded.map(({ spotMarketState }) => spotMarketState),
    decoded.map(({ userState }) => userState)
  );
  const rewards = await getDriftRewards(
    rpc,
    markets,
    decoded.map(({ bankAddress, spotMarketState, userState }) => ({
      bankAddress,
      marketMint: spotMarketState.mint,
      driftUser: userState,
    }))
  );

  return Object.fromEntries(
    decoded.map(({ bankAddress, spotMarketState, userState }) => [
      bankAddress,
      { spotMarketState, userState, userRewards: rewards.get(bankAddress) ?? [] },
    ])
  );
}

/**
 * {@link fetchDriftStates} in the JSON wire format served by API routes.
 * @throws see {@link fetchDriftStates}
 */
export async function fetchDriftStatesDto(
  rpc: Rpc<GetMultipleAccountsApi>,
  banks: DriftBankInput[]
): Promise<Record<string, DriftStatesJSON>> {
  const states = await fetchDriftStates(rpc, banks);
  return Object.fromEntries(
    Object.entries(states).map(([bank, { spotMarketState, userState, userRewards }]) => [
      bank,
      {
        spotMarketState: driftSpotMarketRawToDto(spotMarketState),
        userState: driftUserRawToDto(userState),
        userRewards: userRewards.map(driftRewardsRawToDto),
      },
    ])
  );
}
