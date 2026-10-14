import { Buffer } from "buffer";

import { Connection, PublicKey, StakeProgram } from "@solana/web3.js";
import { BigNumber } from "bignumber.js";

import { fetchStakeAccount } from "./fetch.utils";
import { getStakedBankMetadataMap } from "./metadata.utils";

import { chunkedGetRawMultipleAccountInfoOrderedWithNulls } from "~/services/misc";
import {
  findPoolAddress,
  findPoolStakeAddress,
  findPoolMintAddress,
  findPoolOnRampAddress,
} from "~/vendor/single-spl-pool";

// The pool-locked stake no LST is minted against: single-pool's `PHANTOM_TOKEN_AMOUNT`, and the
// bootstrap marginfi's legacy rate subtracts
const POOL_BOOTSTRAP_LAMPORTS = 1_000_000_000n;

// `StakeStateV2::Stake`, the only state with a delegation
const STAKE_STATE_DELEGATED = 2;

/**
 * Minimal bank shape required to compute staked-bank multipliers.
 * Kept local to avoid a hard dependency on the Bank model.
 */
interface StakedBankLike {
  address: PublicKey;
  stakedOracleUsesOnramp?: boolean;
}

/**
 * Computes the asset-share multiplier (SOL per LST) for each staked bank, as the program prices it:
 * - with on-ramp pricing (`stakedOracleUsesOnramp`): the lamports of the pool's stake account and
 *   on-ramp above rent, over the LST supply plus the pool's 1 SOL phantom supply;
 * - otherwise: the pool's delegated stake above its 1 SOL bootstrap, over the LST supply. This
 *   legacy rate is slightly below what the pool redeems an LST for, since it leaves out
 *   undelegated and on-ramp lamports.
 *
 * Banks whose metadata cannot be resolved, whose pool stake account or LST mint cannot be
 * fetched, or whose LST supply is zero default to a multiplier of 1.
 *
 * @param stakedBanks - Banks with `assetTag === AssetTag.STAKED`
 * @param connection  - Solana RPC connection
 * @returns Map of bank address (base58) → BigNumber multiplier
 */
export async function computeStakedBankMultipliers(
  stakedBanks: StakedBankLike[],
  connection: Connection
): Promise<Map<string, BigNumber>> {
  const multiplierByBank = new Map<string, BigNumber>();

  if (stakedBanks.length === 0) {
    return multiplierByBank;
  }

  const metadataMap = getStakedBankMetadataMap();

  // Derive each staked bank's pool stake account, LST mint and on-ramp
  const resolvedBanks: StakedBankLike[] = [];
  const poolStakeAddresses: PublicKey[] = [];
  const lstMintAddresses: PublicKey[] = [];
  const onrampAddresses: PublicKey[] = [];

  for (const bank of stakedBanks) {
    const metadata = metadataMap.get(bank.address.toBase58());
    if (!metadata) {
      multiplierByBank.set(bank.address.toBase58(), new BigNumber(1));
      continue;
    }
    const pool = findPoolAddress(new PublicKey(metadata.validatorVoteAccount));
    resolvedBanks.push(bank);
    poolStakeAddresses.push(findPoolStakeAddress(pool));
    lstMintAddresses.push(findPoolMintAddress(pool));
    onrampAddresses.push(findPoolOnRampAddress(pool));
  }

  if (resolvedBanks.length === 0) {
    return multiplierByBank;
  }

  const allAddresses = [...poolStakeAddresses, ...lstMintAddresses, ...onrampAddresses].map((a) =>
    a.toBase58()
  );
  const [accountInfos, stakeRent] = await Promise.all([
    chunkedGetRawMultipleAccountInfoOrderedWithNulls(connection, allAddresses),
    resolvedBanks.some((bank) => bank.stakedOracleUsesOnramp)
      ? connection.getMinimumBalanceForRentExemption(StakeProgram.space)
      : 0,
  ]);
  const count = resolvedBanks.length;
  const aboveRent = (lamports: number) => Math.max(lamports - stakeRent, 0);

  resolvedBanks.forEach((bank, i) => {
    const bankAddr = bank.address.toBase58();
    const poolStakeInfo = accountInfos[i];
    const lstMintInfo = accountInfos[count + i];
    const onrampInfo = accountInfos[2 * count + i];

    // LST mint supply is stored at offset 36, as a little-endian u64
    const lstMintSupply = lstMintInfo
      ? Buffer.from(lstMintInfo.data.subarray(36, 44)).readBigUInt64LE(0)
      : 0n;
    if (!poolStakeInfo || lstMintSupply === 0n) {
      multiplierByBank.set(bankAddr, new BigNumber(1));
      return;
    }

    if (bank.stakedOracleUsesOnramp) {
      const value =
        aboveRent(poolStakeInfo.lamports) + (onrampInfo ? aboveRent(onrampInfo.lamports) : 0);
      multiplierByBank.set(
        bankAddr,
        new BigNumber(value).dividedBy((lstMintSupply + POOL_BOOTSTRAP_LAMPORTS).toString())
      );
      return;
    }

    const delegated =
      poolStakeInfo.data.readUInt32LE(0) === STAKE_STATE_DELEGATED
        ? fetchStakeAccount(poolStakeInfo.data).stake.delegation.stake
        : 0n;
    const delegatedAboveBootstrap =
      delegated > POOL_BOOTSTRAP_LAMPORTS ? delegated - POOL_BOOTSTRAP_LAMPORTS : 0n;
    multiplierByBank.set(
      bankAddr,
      new BigNumber(delegatedAboveBootstrap.toString()).dividedBy(lstMintSupply.toString())
    );
  });

  return multiplierByBank;
}
