import BN from "bn.js";
import { PublicKey } from "@solana/web3.js";
import { JupLendingState, JupLendingRewardsRateModel } from "../types";
import {
  calculateJupLendTotalAssets,
  calculateJupLendRewardsRate,
  JupLendRewardsResult,
} from "./interest-rate.utils";

/**
 * Calculate the rewards info for a jup-lend market from pre-fetched state.
 *
 * @param lendingState - The on-chain Lending account
 * @param rewardsModel - The on-chain LendingRewardsRateModel account
 * @param fTokenTotalSupply - Total supply of the fToken
 * @returns Rewards result with rate, ended flag, and start time
 */
export function getJupLendRewards(
  lendingState: JupLendingState,
  rewardsModel: JupLendingRewardsRateModel,
  fTokenTotalSupply: BN
): JupLendRewardsResult {
  if (lendingState.rewardsRateModel.equals(PublicKey.default)) {
    return {
      rewardsRate: new BN(0),
      rewardsEnded: false,
      rewardsStartTime: new BN(0),
    };
  }

  const totalAssets = calculateJupLendTotalAssets(lendingState, fTokenTotalSupply);
  const currentTimestamp = new BN(Math.floor(Date.now() / 1000));

  return calculateJupLendRewardsRate(rewardsModel, totalAssets, currentTimestamp);
}
