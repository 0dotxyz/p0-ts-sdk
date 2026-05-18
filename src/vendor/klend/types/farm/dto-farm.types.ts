/**
 * JSON-friendly counterpart of {@link KaminoFarm} and friends. PublicKey
 * fields become base58 strings, BN fields become decimal strings.
 */
export interface KaminoFarmTokenInfoDto {
  mint: string;
  decimals: string;
}

export interface KaminoFarmRewardSchedulePointDto {
  tsStart: string;
  rewardPerTimeUnit: string;
}

export interface KaminoFarmRewardScheduleCurveDto {
  points: Array<KaminoFarmRewardSchedulePointDto>;
}

export interface KaminoFarmRewardInfoDto {
  token: KaminoFarmTokenInfoDto;
  rewardsAvailable: string;
  rewardScheduleCurve: KaminoFarmRewardScheduleCurveDto;
  rewardsPerSecondDecimals: number;
}

export interface KaminoFarmDto {
  rewardInfos: Array<KaminoFarmRewardInfoDto>;
}
