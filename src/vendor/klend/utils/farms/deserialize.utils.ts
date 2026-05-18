import { struct, publicKey, u64, array, u8, u128, u32 } from "@coral-xyz/borsh";

import { FarmStateRaw } from "../../types/farm/raw-farm.types";
import { KaminoFarm } from "../../types/farm/farm.types";
import { KaminoFarmDto } from "../../types/farm/dto-farm.types";
import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";

const farmDiscriminator = Buffer.from([198, 102, 216, 74, 63, 66, 163, 190]);

const farmLayout = struct<FarmStateRaw>([
  publicKey("farmAdmin"),
  publicKey("globalConfig"),
  struct(
    [publicKey("mint"), u64("decimals"), publicKey("tokenProgram"), array(u64(), 6, "padding")],
    "token"
  ),
  array(
    struct([
      struct(
        [publicKey("mint"), u64("decimals"), publicKey("tokenProgram"), array(u64(), 6, "padding")],
        "token"
      ),
      publicKey("rewardsVault"),
      u64("rewardsAvailable"),
      struct(
        [array(struct([u64("tsStart"), u64("rewardPerTimeUnit")]), 20, "points")],
        "rewardScheduleCurve"
      ),
      u64("minClaimDurationSeconds"),
      u64("lastIssuanceTs"),
      u64("rewardsIssuedUnclaimed"),
      u64("rewardsIssuedCumulative"),
      u128("rewardPerShareScaled"),
      u64("placeholder0"),
      u8("rewardType"),
      u8("rewardsPerSecondDecimals"),
      array(u8(), 6, "padding0"),
      array(u64(), 20, "padding1"),
    ]),
    10,
    "rewardInfos"
  ),
  u64("numRewardTokens"),
  u64("numUsers"),
  u64("totalStakedAmount"),
  publicKey("farmVault"),
  publicKey("farmVaultsAuthority"),
  u64("farmVaultsAuthorityBump"),
  publicKey("delegateAuthority"),
  u8("timeUnit"),
  u8("isFarmFrozen"),
  u8("isFarmDelegated"),
  array(u8(), 5, "padding0"),
  publicKey("withdrawAuthority"),
  u32("depositWarmupPeriod"),
  u32("withdrawalCooldownPeriod"),
  u128("totalActiveStakeScaled"),
  u128("totalPendingStakeScaled"),
  u64("totalPendingAmount"),
  u64("slashedAmountCurrent"),
  u64("slashedAmountCumulative"),
  publicKey("slashedAmountSpillAddress"),
  u64("lockingMode"),
  u64("lockingStartTimestamp"),
  u64("lockingDuration"),
  u64("lockingEarlyWithdrawalPenaltyBps"),
  u64("depositCapAmount"),
  publicKey("scopePrices"),
  u64("scopeOraclePriceId"),
  u64("scopeOracleMaxAge"),
  publicKey("pendingFarmAdmin"),
  publicKey("strategyId"),
  publicKey("delegatedRpsAdmin"),
  publicKey("vaultId"),
  publicKey("secondDelegatedAuthority"),
  array(u64(), 74, "padding"),
]);

export function decodeFarmDataRaw(data: Buffer): FarmStateRaw {
  if (!data.slice(0, 8).equals(farmDiscriminator)) {
    throw new Error("invalid account discriminator");
  }

  const dec = farmLayout.decode(data.slice(8));
  return dec;
}

export function dtoToKaminoFarm(dto: KaminoFarmDto): KaminoFarm {
  return {
    rewardInfos: dto.rewardInfos.map((info) => ({
      token: {
        mint: new PublicKey(info.token.mint),
        decimals: new BN(info.token.decimals),
      },
      rewardsAvailable: new BN(info.rewardsAvailable),
      rewardScheduleCurve: {
        points: info.rewardScheduleCurve.points.map((p) => ({
          tsStart: new BN(p.tsStart),
          rewardPerTimeUnit: new BN(p.rewardPerTimeUnit),
        })),
      },
      rewardsPerSecondDecimals: info.rewardsPerSecondDecimals,
    })),
  };
}
