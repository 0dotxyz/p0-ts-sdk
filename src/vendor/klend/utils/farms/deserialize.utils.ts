import { struct, publicKey, u64, array, u8, u128, u32 } from "@coral-xyz/borsh";

import { FarmStateRaw } from "../../types/farm/raw-farm.types";
import { FarmStateJSON } from "../../types/farm/dto-farm.types";
import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";

const farmDiscriminator = Buffer.from([198, 102, 216, 74, 63, 66, 163, 190]);

const farmLayout = struct<FarmStateRaw>([
  publicKey("farmAdmin"),
  publicKey("globalConfig"),
  struct(
    [
      publicKey("mint"),
      u64("decimals"),
      publicKey("tokenProgram"),
      array(u64(), 6, "padding"),
    ],
    "token"
  ),
  array(
    struct([
      struct(
        [
          publicKey("mint"),
          u64("decimals"),
          publicKey("tokenProgram"),
          array(u64(), 6, "padding"),
        ],
        "token"
      ),
      publicKey("rewardsVault"),
      u64("rewardsAvailable"),
      struct(
        [
          array(
            struct([u64("tsStart"), u64("rewardPerTimeUnit")]),
            20,
            "points"
          ),
        ],
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

export function dtoToFarmRaw(dto: FarmStateJSON): FarmStateRaw {
  return {
    farmAdmin: new PublicKey(dto.farmAdmin),
    globalConfig: new PublicKey(dto.globalConfig),
    token: {
      mint: new PublicKey(dto.token.mint),
      decimals: new BN(dto.token.decimals),
      tokenProgram: new PublicKey(dto.token.tokenProgram),
      padding: dto.token.padding.map((item) => new BN(item)),
    },
    rewardInfos: dto.rewardInfos.map((item) => ({
      token: {
        mint: new PublicKey(item.token.mint),
        decimals: new BN(item.token.decimals),
        tokenProgram: new PublicKey(item.token.tokenProgram),
        padding: item.token.padding.map((p) => new BN(p)),
      },
      rewardsVault: new PublicKey(item.rewardsVault),
      rewardsAvailable: new BN(item.rewardsAvailable),
      rewardScheduleCurve: {
        points: item.rewardScheduleCurve.points.map((p) => ({
          tsStart: new BN(p.tsStart),
          rewardPerTimeUnit: new BN(p.rewardPerTimeUnit),
        })),
      },
      minClaimDurationSeconds: new BN(item.minClaimDurationSeconds),
      lastIssuanceTs: new BN(item.lastIssuanceTs),
      rewardsIssuedUnclaimed: new BN(item.rewardsIssuedUnclaimed),
      rewardsIssuedCumulative: new BN(item.rewardsIssuedCumulative),
      rewardPerShareScaled: new BN(item.rewardPerShareScaled),
      placeholder0: new BN(item.placeholder0),
      rewardType: item.rewardType,
      rewardsPerSecondDecimals: item.rewardsPerSecondDecimals,
      padding0: item.padding0,
      padding1: item.padding1.map((p) => new BN(p)),
    })),
    numRewardTokens: new BN(dto.numRewardTokens),
    numUsers: new BN(dto.numUsers),
    totalStakedAmount: new BN(dto.totalStakedAmount),
    farmVault: new PublicKey(dto.farmVault),
    farmVaultsAuthority: new PublicKey(dto.farmVaultsAuthority),
    farmVaultsAuthorityBump: new BN(dto.farmVaultsAuthorityBump),
    delegateAuthority: new PublicKey(dto.delegateAuthority),
    timeUnit: dto.timeUnit,
    isFarmFrozen: dto.isFarmFrozen,
    isFarmDelegated: dto.isFarmDelegated,
    padding0: dto.padding0,
    withdrawAuthority: new PublicKey(dto.withdrawAuthority),
    depositWarmupPeriod: dto.depositWarmupPeriod,
    withdrawalCooldownPeriod: dto.withdrawalCooldownPeriod,
    totalActiveStakeScaled: new BN(dto.totalActiveStakeScaled),
    totalPendingStakeScaled: new BN(dto.totalPendingStakeScaled),
    totalPendingAmount: new BN(dto.totalPendingAmount),
    slashedAmountCurrent: new BN(dto.slashedAmountCurrent),
    slashedAmountCumulative: new BN(dto.slashedAmountCumulative),
    slashedAmountSpillAddress: new PublicKey(dto.slashedAmountSpillAddress),
    lockingMode: new BN(dto.lockingMode),
    lockingStartTimestamp: new BN(dto.lockingStartTimestamp),
    lockingDuration: new BN(dto.lockingDuration),
    lockingEarlyWithdrawalPenaltyBps: new BN(
      dto.lockingEarlyWithdrawalPenaltyBps
    ),
    depositCapAmount: new BN(dto.depositCapAmount),
    scopePrices: new PublicKey(dto.scopePrices),
    scopeOraclePriceId: new BN(dto.scopeOraclePriceId),
    scopeOracleMaxAge: new BN(dto.scopeOracleMaxAge),
    pendingFarmAdmin: new PublicKey(dto.pendingFarmAdmin),
    strategyId: new PublicKey(dto.strategyId),
    delegatedRpsAdmin: new PublicKey(dto.delegatedRpsAdmin),
    vaultId: new PublicKey(dto.vaultId),
    secondDelegatedAuthority: new PublicKey(dto.secondDelegatedAuthority),
    padding: dto.padding.map((item) => new BN(item)),
  };
}
