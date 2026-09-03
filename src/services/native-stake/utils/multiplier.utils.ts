import { Buffer } from "buffer";

import { Connection, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import BigNumber from "bignumber.js";

import { getStakedBankMetadataMap } from "./metadata.utils";

import { chunkedGetRawMultipleAccountInfoOrdered } from "~/services/misc";
import {
  findPoolAddress,
  findPoolStakeAddress,
  findPoolMintAddress,
} from "~/vendor/single-spl-pool";

/**
 * Minimal bank shape required to compute staked-bank multipliers.
 * Kept local to avoid a hard dependency on the Bank model.
 */
interface StakedBankLike {
  address: PublicKey;
}

/**
 * Computes the asset-share multiplier (LST → SOL ratio) for each staked bank.
 *
 * For each staked bank:
 *   multiplier = max(stakeLamports - LAMPORTS_PER_SOL, 0) / lstMintSupply
 *
 * Banks whose metadata cannot be resolved, or whose pool accounts cannot be
 * fetched, default to a multiplier of 1.
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

  // Derive pool stake addresses and LST mint addresses for each staked bank
  const stakedBankAddresses: string[] = [];
  const poolStakeAddresses: PublicKey[] = [];
  const lstMintAddresses: PublicKey[] = [];

  for (const bank of stakedBanks) {
    const metadata = metadataMap.get(bank.address.toBase58());
    if (!metadata) {
      multiplierByBank.set(bank.address.toBase58(), new BigNumber(1));
      continue;
    }
    const pool = findPoolAddress(new PublicKey(metadata.validatorVoteAccount));
    stakedBankAddresses.push(bank.address.toBase58());
    poolStakeAddresses.push(findPoolStakeAddress(pool));
    lstMintAddresses.push(findPoolMintAddress(pool));
  }

  if (stakedBankAddresses.length === 0) {
    return multiplierByBank;
  }

  // Batch-fetch pool stake accounts and LST mint supplies
  const allAddresses = [
    ...poolStakeAddresses.map((a) => a.toBase58()),
    ...lstMintAddresses.map((a) => a.toBase58()),
  ];
  const accountInfos = await chunkedGetRawMultipleAccountInfoOrdered(connection, allAddresses);
  const poolStakeInfos = accountInfos.slice(0, poolStakeAddresses.length);
  const lstMintInfos = accountInfos.slice(poolStakeAddresses.length);

  for (let i = 0; i < stakedBankAddresses.length; i++) {
    const bankAddr = stakedBankAddresses[i];
    const poolStakeInfo = poolStakeInfos[i];
    const lstMintInfo = lstMintInfos[i];

    if (!poolStakeInfo || !lstMintInfo) {
      multiplierByBank.set(bankAddr, new BigNumber(1));
      continue;
    }

    const stakeLamports = poolStakeInfo.lamports;
    // LST mint supply is stored at offset 36, as a little-endian u64
    const supplyBuffer = lstMintInfo.data.slice(36, 44);
    const lstMintSupply = Number(Buffer.from(supplyBuffer).readBigUInt64LE(0));

    if (lstMintSupply === 0) {
      multiplierByBank.set(bankAddr, new BigNumber(1));
      continue;
    }

    // multiplier = (stakeInPool - LAMPORTS_PER_SOL) / lstMintSupply
    const adjustedStake = Math.max(stakeLamports - LAMPORTS_PER_SOL, 0);
    const multiplier = new BigNumber(adjustedStake).dividedBy(lstMintSupply);
    multiplierByBank.set(bankAddr, multiplier);
  }

  return multiplierByBank;
}
