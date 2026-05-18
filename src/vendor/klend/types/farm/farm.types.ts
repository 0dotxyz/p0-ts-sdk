import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";

/**
 * Slim subset of {@link FarmStateRaw} containing only the fields used by the
 * app and the Kamino farm reward utilities.
 */
export interface KaminoFarmTokenInfo {
  mint: PublicKey;
  decimals: BN;
}

export interface KaminoFarmRewardSchedulePoint {
  tsStart: BN;
  rewardPerTimeUnit: BN;
}

export interface KaminoFarmRewardScheduleCurve {
  points: Array<KaminoFarmRewardSchedulePoint>;
}

export interface KaminoFarmRewardInfo {
  token: KaminoFarmTokenInfo;
  rewardsAvailable: BN;
  rewardScheduleCurve: KaminoFarmRewardScheduleCurve;
  rewardsPerSecondDecimals: number;
}

export interface KaminoFarm {
  rewardInfos: Array<KaminoFarmRewardInfo>;
}
