/**
 * JSON-serializable DTO for the LendingRewardsRateModel account.
 * PublicKey → string, BN → string.
 */
export interface JupLendingRewardsRateModelJSON {
  pubkey: string;
  mint: string;
  startTvl: string;
  duration: string;
  startTime: string;
  yearlyReward: string;
  nextDuration: string;
  nextRewardAmount: string;
  bump?: number;
}
