import { address, type Address, type GetMultipleAccountsApi, type Rpc } from "@solana/kit";

import { deriveDriftSpotMarket } from "./pda";
import type { DriftRewards, DriftSpotMarket, DriftUser } from "./types";

import { fetchAllMaybeSpotMarket } from "~/generated/drift";

const USDC_MINT = address("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");

/** Returns `spotMarkets` plus any market in `marketIndexes` not among them, fetched. */
async function withMissingMarkets(
  rpc: Rpc<GetMultipleAccountsApi>,
  spotMarkets: DriftSpotMarket[],
  marketIndexes: Iterable<number>
): Promise<Map<number, DriftSpotMarket>> {
  const markets = new Map(spotMarkets.map((market) => [market.marketIndex, market]));
  const missing = [...new Set(marketIndexes)].filter((index) => !markets.has(index));
  const addresses = await Promise.all(
    missing.map(async (index) => (await deriveDriftSpotMarket(index))[0])
  );
  for (const account of addresses.length ? await fetchAllMaybeSpotMarket(rpc, addresses) : []) {
    if (account.exists) {
      markets.set(account.data.marketIndex, account.data);
    } else {
      console.error("Missing Drift spot market account", account.address);
    }
  }
  return markets;
}

/**
 * Drift rewards of each bank. Rewards are credited as extra spot positions on the bank's Drift user:
 * positions are `[USDC, token, ...rewards]` (`[USDC, ...rewards]` for a USDC bank). Reward markets
 * not in `spotMarkets` are fetched.
 * @returns rewards keyed by bank address
 */
export async function getDriftRewards(
  rpc: Rpc<GetMultipleAccountsApi>,
  spotMarkets: DriftSpotMarket[],
  userStates: { bankAddress: Address; marketMint: Address; driftUser: DriftUser }[]
): Promise<Map<Address, DriftRewards[]>> {
  const rewardsByBank = userStates.map((userState) => ({
    userState,
    rewards: userState.driftUser.spotPositions
      .slice(userState.marketMint === USDC_MINT ? 1 : 2)
      .filter((position) => position.marketIndex !== 0),
  }));

  const markets = await withMissingMarkets(
    rpc,
    spotMarkets,
    rewardsByBank.flatMap(({ rewards }) => rewards.map((reward) => reward.marketIndex))
  );

  return new Map(
    await Promise.all(
      rewardsByBank.map(async ({ userState, rewards }) => {
        const driftRewards: DriftRewards[] = [];
        for (const reward of rewards) {
          const market = markets.get(reward.marketIndex);
          if (!market) {
            console.error("Missing Drift spot market", reward.marketIndex);
            continue;
          }
          driftRewards.push({
            oracle: market.oracle,
            marketIndex: reward.marketIndex,
            spotMarket: (await deriveDriftSpotMarket(reward.marketIndex))[0],
            mint: market.mint,
            spotPosition: reward,
          });
        }
        return [userState.bankAddress, driftRewards] as const;
      })
    )
  );
}

/** `spotMarkets` plus every market any of `driftUsers` has a position in, fetched if missing. */
export async function getAllRequiredMarkets(
  rpc: Rpc<GetMultipleAccountsApi>,
  spotMarkets: DriftSpotMarket[],
  driftUsers: DriftUser[]
): Promise<DriftSpotMarket[]> {
  const markets = await withMissingMarkets(
    rpc,
    spotMarkets,
    driftUsers.flatMap((user) => user.spotPositions.map((position) => position.marketIndex))
  );
  return [...markets.values()];
}
