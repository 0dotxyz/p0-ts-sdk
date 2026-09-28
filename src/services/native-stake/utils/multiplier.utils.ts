import type { GetMultipleAccountsApi, Rpc } from "@solana/kit";
import { getMintDecoder } from "@solana-program/token";
import { BigNumber } from "bignumber.js";

import { BankType } from "~/services/bank";
import { chunkedGetRawMultipleAccountInfoOrderedWithNulls } from "~/utils";

/**
 * SOL per LST of each staked bank, keyed by bank address: its pool's stake above the pool's 1 SOL
 * minimum over the LST supply. 1 when the pool stake account or LST mint is missing or the supply is
 * zero.
 */
export async function computeStakedBankMultipliers(
  rpc: Rpc<GetMultipleAccountsApi>,
  stakedBanks: BankType[]
): Promise<Map<string, BigNumber>> {
  // A staked bank's oracle keys 1 and 2 are its pool's LST mint and stake account.
  const accounts = await chunkedGetRawMultipleAccountInfoOrderedWithNulls(
    rpc,
    stakedBanks.flatMap((bank) => [bank.config.oracleKeys[2], bank.config.oracleKeys[1]])
  );

  return new Map(
    stakedBanks.map((bank, i) => {
      const [poolStake, lstMint] = accounts.slice(2 * i, 2 * i + 2);
      const supply = lstMint ? getMintDecoder().decode(lstMint.data).supply : 0n;
      if (!poolStake || supply === 0n) return [bank.address, new BigNumber(1)];

      const stakeAboveMinimum =
        poolStake.lamports > 1_000_000_000n ? poolStake.lamports - 1_000_000_000n : 0n;
      return [
        bank.address,
        new BigNumber(stakeAboveMinimum.toString()).dividedBy(supply.toString()),
      ];
    })
  );
}
