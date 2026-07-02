import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";

/**
 * Curated Kamino FarmState used throughout the codebase.
 *
 * Keeps only the staked token identity and the reward schedule data
 * needed to compute reward APYs.
 */
export interface KaminoFarmState {
  token: KaminoFarmTokenInfo;
  rewardInfos: Array<KaminoFarmRewardInfo>;
}

export interface KaminoFarmTokenInfo {
  mint: PublicKey;
  decimals: BN;
}

export interface KaminoFarmRewardInfo {
  token: KaminoFarmTokenInfo;
  /** Amount of rewards remaining in the rewards vault */
  rewardsAvailable: BN;
  rewardsPerSecondDecimals: number;
  rewardScheduleCurve: KaminoRewardScheduleCurve;
}

export interface KaminoRewardScheduleCurve {
  /**
   * This is a stepwise function, meaning that each point represents
   * how many rewards are issued per time unit since the beginning
   * of that point until the beginning of the next point.
   */
  points: Array<KaminoRewardCurvePoint>;
}

export interface KaminoRewardCurvePoint {
  tsStart: BN;
  rewardPerTimeUnit: BN;
}
