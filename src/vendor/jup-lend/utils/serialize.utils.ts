import {
  JupLendingState,
  JupLendingStateJSON,
  JupLendingRewardsRateModel,
  JupLendingRewardsRateModelJSON,
  JupTokenReserve,
  JupTokenReserveJSON,
  JupRateModel,
  JupRateModelJSON,
} from "../types";

// ============================================================================
// RAW → DTO CONVERTERS
// ============================================================================

export function jupLendingStateRawToDto(raw: JupLendingState): JupLendingStateJSON {
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
  };
}

export function jupTokenReserveRawToDto(raw: JupTokenReserve): JupTokenReserveJSON {
  return {
    pubkey: raw.pubkey.toBase58(),
    borrowRate: raw.borrowRate,
    feeOnInterest: raw.feeOnInterest,
    lastUtilization: raw.lastUtilization,
    supplyExchangePrice: raw.supplyExchangePrice.toString(),
    borrowExchangePrice: raw.borrowExchangePrice.toString(),
    totalSupplyWithInterest: raw.totalSupplyWithInterest.toString(),
    totalSupplyInterestFree: raw.totalSupplyInterestFree.toString(),
    totalBorrowWithInterest: raw.totalBorrowWithInterest.toString(),
    totalBorrowInterestFree: raw.totalBorrowInterestFree.toString(),
  };
}

export function jupLendingRewardsRateModelRawToDto(
  raw: JupLendingRewardsRateModel
): JupLendingRewardsRateModelJSON {
  return {
    startTvl: raw.startTvl.toString(),
    duration: raw.duration.toString(),
    startTime: raw.startTime.toString(),
    yearlyReward: raw.yearlyReward.toString(),
  };
}

export function jupRateModelRawToDto(raw: JupRateModel): JupRateModelJSON {
  return {
    version: raw.version,
    rateAtZero: raw.rateAtZero,
    kink1Utilization: raw.kink1Utilization,
    rateAtKink1: raw.rateAtKink1,
    rateAtMax: raw.rateAtMax,
    kink2Utilization: raw.kink2Utilization,
    rateAtKink2: raw.rateAtKink2,
  };
}
