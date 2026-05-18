import { FarmStateRaw, KaminoFarm, KaminoFarmDto } from "../../types";

/**
 * Project a full {@link FarmStateRaw} into the slim {@link KaminoFarm}
 * containing only the fields the app reads.
 */
export function kaminoFarmFromRaw(raw: FarmStateRaw): KaminoFarm {
  return {
    rewardInfos: raw.rewardInfos.map((info) => ({
      token: {
        mint: info.token.mint,
        decimals: info.token.decimals,
      },
      rewardsAvailable: info.rewardsAvailable,
      rewardScheduleCurve: {
        points: info.rewardScheduleCurve.points.map((p) => ({
          tsStart: p.tsStart,
          rewardPerTimeUnit: p.rewardPerTimeUnit,
        })),
      },
      rewardsPerSecondDecimals: info.rewardsPerSecondDecimals,
    })),
  };
}

export function kaminoFarmToDto(farm: KaminoFarm): KaminoFarmDto {
  return {
    rewardInfos: farm.rewardInfos.map((info) => ({
      token: {
        mint: info.token.mint.toBase58(),
        decimals: info.token.decimals.toString(),
      },
      rewardsAvailable: info.rewardsAvailable.toString(),
      rewardScheduleCurve: {
        points: info.rewardScheduleCurve.points.map((p) => ({
          tsStart: p.tsStart.toString(),
          rewardPerTimeUnit: p.rewardPerTimeUnit.toString(),
        })),
      },
      rewardsPerSecondDecimals: info.rewardsPerSecondDecimals,
    })),
  };
}
