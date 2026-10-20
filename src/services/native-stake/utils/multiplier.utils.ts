import type {
  GetMinimumBalanceForRentExemptionApi,
  GetMultipleAccountsApi,
  Rpc,
} from "@solana/kit";
import { getStakeStateAccountDecoder } from "@solana-program/stake";
import { getMintDecoder } from "@solana-program/token";
import { BigNumber } from "bignumber.js";

import { STAKE_ACCOUNT_SIZE } from "~/constants";
import { BankType } from "~/services/bank";
import { chunkedGetRawMultipleAccountInfoOrderedWithNulls } from "~/utils";

// The pool-locked stake no LST is minted against: single-pool's `PHANTOM_TOKEN_AMOUNT`, and the
// bootstrap marginfi's legacy rate subtracts
const POOL_BOOTSTRAP_LAMPORTS = 1_000_000_000n;

/**
 * SOL per LST of each staked bank, keyed by bank address, as the program prices it:
 * - with on-ramp pricing (`stakedOracleUsesOnramp`): the lamports of the pool's stake account and
 *   on-ramp above rent, over the LST supply plus the pool's 1 SOL phantom supply;
 * - otherwise: the pool's delegated stake above its 1 SOL bootstrap, over the LST supply. This
 *   legacy rate is slightly below what the pool redeems an LST for, since it leaves out
 *   undelegated and on-ramp lamports.
 *
 * 1 when the pool's stake account or LST mint is missing or the supply is zero. Banks with staked
 * pricing disabled (`stakedOracleDisabled`) can't be priced on-chain and aren't modeled.
 */
export async function computeStakedBankMultipliers(
  rpc: Rpc<GetMultipleAccountsApi & GetMinimumBalanceForRentExemptionApi>,
  stakedBanks: BankType[]
): Promise<Map<string, BigNumber>> {
  // A staked bank's oracle keys 1, 2 and 3 are its pool's LST mint, stake account and on-ramp.
  const [accounts, stakeRent] = await Promise.all([
    chunkedGetRawMultipleAccountInfoOrderedWithNulls(
      rpc,
      stakedBanks.flatMap((bank) => [
        bank.config.oracleKeys[2],
        bank.config.oracleKeys[1],
        bank.config.oracleKeys[3],
      ])
    ),
    stakedBanks.some((bank) => bank.stakedOracleUsesOnramp)
      ? rpc.getMinimumBalanceForRentExemption(STAKE_ACCOUNT_SIZE).send()
      : 0n,
  ]);
  const aboveRent = (lamports: bigint) => (lamports > stakeRent ? lamports - stakeRent : 0n);

  return new Map(
    stakedBanks.map((bank, i) => {
      const [poolStake, lstMint, onramp] = accounts.slice(3 * i, 3 * i + 3);
      const supply = lstMint ? getMintDecoder().decode(lstMint.data).supply : 0n;
      if (!poolStake || supply === 0n) return [bank.address, new BigNumber(1)];

      if (bank.stakedOracleUsesOnramp) {
        const value = aboveRent(poolStake.lamports) + (onramp ? aboveRent(onramp.lamports) : 0n);
        return [
          bank.address,
          new BigNumber(value.toString()).dividedBy((supply + POOL_BOOTSTRAP_LAMPORTS).toString()),
        ];
      }

      const { state } = getStakeStateAccountDecoder().decode(poolStake.data);
      const delegated = state.__kind === "Stake" ? state.fields[1].delegation.stake : 0n;
      const delegatedAboveBootstrap =
        delegated > POOL_BOOTSTRAP_LAMPORTS ? delegated - POOL_BOOTSTRAP_LAMPORTS : 0n;
      return [
        bank.address,
        new BigNumber(delegatedAboveBootstrap.toString()).dividedBy(supply.toString()),
      ];
    })
  );
}
