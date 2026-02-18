import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";

/**
 * Raw on-chain LendingRewardsRateModel account.
 *
 * Controls the rewards distribution parameters for a jup-lend market.
 */
export interface JupLendingRewardsRateModelRaw {
  pubkey: PublicKey;
  /** Mint address */
  mint: PublicKey;
  /** TVL below which rewards rate is 0 */
  startTvl: BN;
  /** Duration for which current rewards should run */
  duration: BN;
  /** Timestamp when current rewards got started */
  startTime: BN;
  /** Annualized reward based on input params (duration, rewardAmount) */
  yearlyReward: BN;
  /** Duration for the next rewards phase */
  nextDuration: BN;
  /** Amount of rewards for the next phase */
  nextRewardAmount: BN;
  bump: number;
}
