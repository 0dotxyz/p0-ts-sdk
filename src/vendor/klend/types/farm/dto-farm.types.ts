/**
 * JSON-serializable DTOs for the curated Kamino FarmState.
 * PublicKey → string, BN → string.
 */
export interface KaminoFarmStateJSON {
  token: KaminoFarmTokenInfoJSON;
  rewardInfos: Array<KaminoFarmRewardInfoJSON>;
}

export interface KaminoFarmTokenInfoJSON {
  mint: string;
  decimals: string;
}

export interface KaminoFarmRewardInfoJSON {
  token: KaminoFarmTokenInfoJSON;
  rewardsAvailable: string;
  rewardsPerSecondDecimals: number;
  rewardScheduleCurve: KaminoRewardScheduleCurveJSON;
}

export interface KaminoRewardScheduleCurveJSON {
  points: Array<KaminoRewardCurvePointJSON>;
}

export interface KaminoRewardCurvePointJSON {
  tsStart: string;
  rewardPerTimeUnit: string;
}
