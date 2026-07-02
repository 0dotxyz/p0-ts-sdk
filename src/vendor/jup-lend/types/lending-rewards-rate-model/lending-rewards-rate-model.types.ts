import BN from "bn.js";

/**
 * Curated LendingRewardsRateModel used throughout the codebase.
 *
 * Controls the rewards distribution parameters for a jup-lend market.
 */
export interface JupLendingRewardsRateModel {
  /** TVL below which rewards rate is 0 */
  startTvl: BN;
  /** Duration for which current rewards should run */
  duration: BN;
  /** Timestamp when current rewards got started */
  startTime: BN;
  /** Annualized reward based on input params (duration, rewardAmount) */
  yearlyReward: BN;
}
