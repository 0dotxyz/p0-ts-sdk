import { PublicKey } from "@solana/web3.js";
import { describe, expect, it } from "vitest";

import { stakeAccountData, stubConnection, type StubAccount } from "../../helpers/connection";

import { fetchStakePoolActiveStates, fetchStakePoolMev } from "~/services/native-stake";
import {
  findPoolAddress,
  findPoolOnRampAddress,
  findPoolStakeAddress,
} from "~/vendor/single-spl-pool";

const STAKE_RENT = 2_282_280;

// Validator A's pool stake account is missing; B's pool is complete
const voteA = PublicKey.unique();
const voteB = PublicKey.unique();
const poolB = findPoolAddress(voteB);
const accounts = new Map<string, StubAccount>([
  [
    findPoolOnRampAddress(findPoolAddress(voteA)).toBase58(),
    { lamports: STAKE_RENT + 7e9, data: stakeAccountData(7_000_000_000n) },
  ],
  [
    findPoolStakeAddress(poolB).toBase58(),
    { lamports: STAKE_RENT + 100e9 + 5_000, data: stakeAccountData(100_000_000_000n, 800n) },
  ],
  [
    findPoolOnRampAddress(poolB).toBase58(),
    { lamports: STAKE_RENT + 2e9, data: stakeAccountData(2_000_000_000n) },
  ],
]);

describe("staked pool fetchers with a missing pool account", () => {
  it("keeps every other validator's MEV on its own accounts", async () => {
    const mev = await fetchStakePoolMev(stubConnection(accounts), [voteA, voteB]);

    expect([...mev]).toEqual([[voteB.toBase58(), { pool: 5_000, onramp: 2_000_000_000 }]]);
  });

  it("reports the validator with a missing pool inactive and the others from their own stake", async () => {
    const states = await fetchStakePoolActiveStates(stubConnection(accounts), [voteA, voteB]);

    expect(states.get(voteA.toBase58())).not.toBe(true);
    expect(states.get(voteB.toBase58())).toBe(true);
  });
});
