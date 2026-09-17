import {
  calculateJupLendRewardsRate,
  calculateJupLendTotalAssets,
  JupLendRewardsResult,
} from "./interest-rate";
import { JupLendingRewardsRateModel, JupLendingState } from "./types";

/**
 * Rewards info of a JupLend market from pre-fetched state.
 * @param fTokenTotalSupply - fToken supply, native units
 */
export function getJupLendRewards(
  lendingState: JupLendingState,
  rewardsModel: JupLendingRewardsRateModel,
  fTokenTotalSupply: bigint
): JupLendRewardsResult {
  if (lendingState.rewardsRateModel === "11111111111111111111111111111111") {
    return { rewardsRate: 0n, rewardsEnded: false, rewardsStartTime: 0n };
  }

  const totalAssets = calculateJupLendTotalAssets(lendingState, fTokenTotalSupply);
  const currentTimestamp = BigInt(Math.floor(Date.now() / 1000));

  return calculateJupLendRewardsRate(rewardsModel, totalAssets, currentTimestamp);
}
