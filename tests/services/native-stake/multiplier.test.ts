import { PublicKey } from "@solana/web3.js";
import { describe, expect, it } from "vitest";

import {
  mintData,
  stakeAccountData,
  stubConnection,
  type StubAccount,
} from "../../helpers/connection";

import { computeStakedBankMultipliers } from "~/services/native-stake";
import {
  findPoolAddress,
  findPoolMintAddress,
  findPoolOnRampAddress,
  findPoolStakeAddress,
} from "~/vendor/single-spl-pool";

// Rent-exempt minimum of a 200-byte stake account in the stub connection
const STAKE_RENT = 2_282_880;

// Two staked banks from the hardcoded metadata, with their validators' vote accounts
const COOL = {
  bank: new PublicKey("8g5qG6PVygcVSXV1cJnjXaD1yhrDwcWAMQCY2wR9VuAf"),
  pool: findPoolAddress(new PublicKey("CooLbbZy5Xmdt7DiHPQ3ss2uRXawnTXXVgpMS8E8jDzr")),
};
const MERIDIAN = {
  bank: new PublicKey("BuCckNm1djpp3vZVhvh1CrrniirY6sr2hwUmeP5kTcGz"),
  pool: findPoolAddress(new PublicKey("mrgn4t2JabSgvGnrCaHXMvz8ocr4F52scsxJnkQMQsQ")),
};

const poolAccounts = (
  pool: PublicKey,
  accounts: { stake: StubAccount; supply: bigint; onramp?: StubAccount }
): [string, StubAccount][] => [
  [findPoolStakeAddress(pool).toBase58(), accounts.stake],
  [findPoolMintAddress(pool).toBase58(), { lamports: 1, data: mintData(accounts.supply) }],
  ...(accounts.onramp
    ? [[findPoolOnRampAddress(pool).toBase58(), accounts.onramp] as [string, StubAccount]]
    : []),
];

// 101 SOL delegated (incl. the 1 SOL bootstrap), 26 SOL undelegated, 9 SOL waiting in the on-ramp
const pool = {
  stake: { lamports: STAKE_RENT + 127e9, data: stakeAccountData(101_000_000_000n) },
  onramp: { lamports: STAKE_RENT + 9e9, data: stakeAccountData(0n) },
};

describe("computeStakedBankMultipliers", () => {
  it("prices a pre-transition pool by its delegated stake above the bootstrap", async () => {
    const connection = stubConnection(
      new Map(poolAccounts(COOL.pool, { ...pool, supply: 80_000_000_000n }))
    );

    const multipliers = await computeStakedBankMultipliers([{ address: COOL.bank }], connection);

    // (101 - 1) / 80, leaving out the undelegated and on-ramp lamports
    expect(multipliers.get(COOL.bank.toBase58())?.toString()).toBe("1.25");
  });

  it("prices an on-ramp pool by both accounts above rent over the supply plus the phantom SOL", async () => {
    const connection = stubConnection(
      new Map(poolAccounts(COOL.pool, { ...pool, supply: 135_000_000_000n }))
    );

    const multipliers = await computeStakedBankMultipliers(
      [{ address: COOL.bank, stakedOracleUsesOnramp: true }],
      connection
    );

    // (127 + 9) / (135 + 1)
    expect(multipliers.get(COOL.bank.toBase58())?.toString()).toBe("1");
  });

  it("counts a missing on-ramp as empty", async () => {
    const connection = stubConnection(
      new Map(poolAccounts(COOL.pool, { stake: pool.stake, supply: 99_000_000_000n }))
    );

    const multipliers = await computeStakedBankMultipliers(
      [{ address: COOL.bank, stakedOracleUsesOnramp: true }],
      connection
    );

    // 127 / (99 + 1)
    expect(multipliers.get(COOL.bank.toBase58())?.toString()).toBe("1.27");
  });

  it("falls back to 1 for a bank without metadata, pool accounts or supply", async () => {
    const unknownBank = PublicKey.unique();
    const connection = stubConnection(
      new Map(poolAccounts(MERIDIAN.pool, { ...pool, supply: 0n }))
    );

    const multipliers = await computeStakedBankMultipliers(
      [{ address: unknownBank }, { address: COOL.bank }, { address: MERIDIAN.bank }],
      connection
    );

    expect(multipliers.get(unknownBank.toBase58())?.toString()).toBe("1");
    expect(multipliers.get(COOL.bank.toBase58())?.toString()).toBe("1");
    expect(multipliers.get(MERIDIAN.bank.toBase58())?.toString()).toBe("1");
  });
});
