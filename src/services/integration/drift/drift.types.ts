import type {
  DriftRewards,
  DriftRewardsJSON,
  DriftSpotMarket,
  DriftSpotMarketJSON,
  DriftUser,
  DriftUserJSON,
  DriftUserStats,
  DriftUserStatsJSON,
} from "~/vendor/drift";

export type DriftStateJsonByBank = Record<
  string,
  {
    driftSpotMarketState: DriftSpotMarketJSON;
    driftUserState: DriftUserJSON;
    driftUserRewards: DriftRewardsJSON[];
    driftUserStatsState?: DriftUserStatsJSON;
  }
>;

export type DriftStateByBank = Record<
  string,
  {
    driftSpotMarketState: DriftSpotMarket;
    driftUserState: DriftUser;
    driftUserRewards: DriftRewards[];
    driftUserStatsState?: DriftUserStats;
  }
>;
