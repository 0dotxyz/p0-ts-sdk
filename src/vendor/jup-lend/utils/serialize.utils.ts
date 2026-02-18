import {
  JupLendingStateRaw,
  JupLendingStateJSON,
  JupLendingAdminRaw,
  JupLendingAdminJSON,
  JupLendingRewardsRateModelRaw,
  JupLendingRewardsRateModelJSON,
} from "../types";

// ============================================================================
// RAW → DTO CONVERTERS
// ============================================================================

export function jupLendingStateRawToDto(
  raw: JupLendingStateRaw
): JupLendingStateJSON {
  return {
    pubkey: raw.pubkey.toBase58(),
    mint: raw.mint.toBase58(),
    fTokenMint: raw.fTokenMint.toBase58(),
    lendingId: raw.lendingId,
    decimals: raw.decimals,
    rewardsRateModel: raw.rewardsRateModel.toBase58(),
    liquidityExchangePrice: raw.liquidityExchangePrice.toString(),
    tokenExchangePrice: raw.tokenExchangePrice.toString(),
    lastUpdateTimestamp: raw.lastUpdateTimestamp.toString(),
    tokenReservesLiquidity: raw.tokenReservesLiquidity.toBase58(),
    supplyPositionOnLiquidity: raw.supplyPositionOnLiquidity.toBase58(),
    bump: raw.bump,
  };
}

export function jupLendingAdminRawToDto(
  raw: JupLendingAdminRaw
): JupLendingAdminJSON {
  return {
    pubkey: raw.pubkey.toBase58(),
    authority: raw.authority.toBase58(),
    liquidityProgram: raw.liquidityProgram.toBase58(),
    rebalancer: raw.rebalancer.toBase58(),
    nextLendingId: raw.nextLendingId,
    auths: raw.auths.map((a) => a.toBase58()),
    bump: raw.bump,
  };
}

export function jupLendingRewardsRateModelRawToDto(
  raw: JupLendingRewardsRateModelRaw
): JupLendingRewardsRateModelJSON {
  return {
    pubkey: raw.pubkey.toBase58(),
    mint: raw.mint.toBase58(),
    startTvl: raw.startTvl.toString(),
    duration: raw.duration.toString(),
    startTime: raw.startTime.toString(),
    yearlyReward: raw.yearlyReward.toString(),
    nextDuration: raw.nextDuration.toString(),
    nextRewardAmount: raw.nextRewardAmount.toString(),
    bump: raw.bump,
  };
}
