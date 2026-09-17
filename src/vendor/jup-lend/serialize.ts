import { address } from "@solana/kit";

import {
  JupLendingRewardsRateModel,
  JupLendingRewardsRateModelJSON,
  JupLendingState,
  JupLendingStateJSON,
  JupRateModel,
  JupRateModelJSON,
  JupTokenReserve,
  JupTokenReserveJSON,
} from "./types";

/** Serializes a JupLend lending state to its JSON DTO. */
export function jupLendingStateRawToDto(state: JupLendingState): JupLendingStateJSON {
  return {
    pubkey: state.pubkey,
    mint: state.mint,
    fTokenMint: state.fTokenMint,
    lendingId: state.lendingId,
    decimals: state.decimals,
    rewardsRateModel: state.rewardsRateModel,
    liquidityExchangePrice: state.liquidityExchangePrice.toString(),
    tokenExchangePrice: state.tokenExchangePrice.toString(),
    lastUpdateTimestamp: state.lastUpdateTimestamp.toString(),
    tokenReservesLiquidity: state.tokenReservesLiquidity,
    supplyPositionOnLiquidity: state.supplyPositionOnLiquidity,
  };
}

/**
 * Parses a JupLend lending state DTO.
 * @throws if an address string is invalid
 */
export function dtoToJupLendingStateRaw(dto: JupLendingStateJSON): JupLendingState {
  return {
    pubkey: address(dto.pubkey),
    mint: address(dto.mint),
    fTokenMint: address(dto.fTokenMint),
    lendingId: dto.lendingId,
    decimals: dto.decimals,
    rewardsRateModel: address(dto.rewardsRateModel),
    liquidityExchangePrice: BigInt(dto.liquidityExchangePrice),
    tokenExchangePrice: BigInt(dto.tokenExchangePrice),
    lastUpdateTimestamp: BigInt(dto.lastUpdateTimestamp),
    tokenReservesLiquidity: address(dto.tokenReservesLiquidity),
    supplyPositionOnLiquidity: address(dto.supplyPositionOnLiquidity),
  };
}

/** Serializes a JupLend token reserve to its JSON DTO. */
export function jupTokenReserveRawToDto(reserve: JupTokenReserve): JupTokenReserveJSON {
  return {
    pubkey: reserve.pubkey,
    borrowRate: reserve.borrowRate,
    feeOnInterest: reserve.feeOnInterest,
    lastUtilization: reserve.lastUtilization,
    supplyExchangePrice: reserve.supplyExchangePrice.toString(),
    borrowExchangePrice: reserve.borrowExchangePrice.toString(),
    totalSupplyWithInterest: reserve.totalSupplyWithInterest.toString(),
    totalSupplyInterestFree: reserve.totalSupplyInterestFree.toString(),
    totalBorrowWithInterest: reserve.totalBorrowWithInterest.toString(),
    totalBorrowInterestFree: reserve.totalBorrowInterestFree.toString(),
  };
}

/**
 * Parses a JupLend token reserve DTO.
 * @throws if an address string is invalid
 */
export function dtoToJupTokenReserveRaw(dto: JupTokenReserveJSON): JupTokenReserve {
  return {
    pubkey: address(dto.pubkey),
    borrowRate: dto.borrowRate,
    feeOnInterest: dto.feeOnInterest,
    lastUtilization: dto.lastUtilization,
    supplyExchangePrice: BigInt(dto.supplyExchangePrice),
    borrowExchangePrice: BigInt(dto.borrowExchangePrice),
    totalSupplyWithInterest: BigInt(dto.totalSupplyWithInterest),
    totalSupplyInterestFree: BigInt(dto.totalSupplyInterestFree),
    totalBorrowWithInterest: BigInt(dto.totalBorrowWithInterest),
    totalBorrowInterestFree: BigInt(dto.totalBorrowInterestFree),
  };
}

/** Serializes a JupLend rewards rate model to its JSON DTO. */
export function jupLendingRewardsRateModelRawToDto(
  model: JupLendingRewardsRateModel
): JupLendingRewardsRateModelJSON {
  return {
    startTvl: model.startTvl.toString(),
    duration: model.duration.toString(),
    startTime: model.startTime.toString(),
    yearlyReward: model.yearlyReward.toString(),
  };
}

/** Parses a JupLend rewards rate model DTO. */
export function dtoToJupLendingRewardsRateModelRaw(
  dto: JupLendingRewardsRateModelJSON
): JupLendingRewardsRateModel {
  return {
    startTvl: BigInt(dto.startTvl),
    duration: BigInt(dto.duration),
    startTime: BigInt(dto.startTime),
    yearlyReward: BigInt(dto.yearlyReward),
  };
}

/** Serializes a JupLend rate model to its JSON DTO. */
export function jupRateModelRawToDto(model: JupRateModel): JupRateModelJSON {
  return {
    version: model.version,
    rateAtZero: model.rateAtZero,
    kink1Utilization: model.kink1Utilization,
    rateAtKink1: model.rateAtKink1,
    rateAtMax: model.rateAtMax,
    kink2Utilization: model.kink2Utilization,
    rateAtKink2: model.rateAtKink2,
  };
}

/** Parses a JupLend rate model DTO. */
export function dtoToJupRateModelRaw(dto: JupRateModelJSON): JupRateModel {
  return {
    version: dto.version,
    rateAtZero: dto.rateAtZero,
    kink1Utilization: dto.kink1Utilization,
    rateAtKink1: dto.rateAtKink1,
    rateAtMax: dto.rateAtMax,
    kink2Utilization: dto.kink2Utilization,
    rateAtKink2: dto.rateAtKink2,
  };
}
