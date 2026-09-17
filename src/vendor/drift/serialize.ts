import { address } from "@solana/kit";

import type {
  DriftRewards,
  DriftRewardsJSON,
  DriftSpotMarket,
  DriftSpotMarketJSON,
  DriftSpotPositionJSON,
  DriftUser,
  DriftUserJSON,
  DriftUserStats,
  DriftUserStatsJSON,
} from "./types";

import type { SpotPosition } from "~/generated/drift";

function spotPositionToDto(position: SpotPosition): DriftSpotPositionJSON {
  return {
    scaledBalance: position.scaledBalance.toString(),
    openBids: position.openBids.toString(),
    openAsks: position.openAsks.toString(),
    cumulativeDeposits: position.cumulativeDeposits.toString(),
    marketIndex: position.marketIndex,
    balanceType: position.balanceType,
    openOrders: position.openOrders,
    padding: [...position.padding],
  };
}

function dtoToSpotPosition(dto: DriftSpotPositionJSON): SpotPosition {
  return {
    scaledBalance: BigInt(dto.scaledBalance),
    openBids: BigInt(dto.openBids),
    openAsks: BigInt(dto.openAsks),
    cumulativeDeposits: BigInt(dto.cumulativeDeposits),
    marketIndex: dto.marketIndex,
    balanceType: dto.balanceType,
    openOrders: dto.openOrders,
    padding: Uint8Array.from(dto.padding),
  };
}

/** Serializes a Drift spot market (or a decoded `SpotMarket`) to its JSON DTO. */
export function driftSpotMarketRawToDto(market: DriftSpotMarket): DriftSpotMarketJSON {
  return {
    pubkey: market.pubkey,
    oracle: market.oracle,
    mint: market.mint,
    decimals: market.decimals,
    marketIndex: market.marketIndex,
    cumulativeDepositInterest: market.cumulativeDepositInterest.toString(),
    cumulativeBorrowInterest: market.cumulativeBorrowInterest.toString(),
    depositBalance: market.depositBalance.toString(),
    borrowBalance: market.borrowBalance.toString(),
    optimalUtilization: market.optimalUtilization,
    optimalBorrowRate: market.optimalBorrowRate,
    maxBorrowRate: market.maxBorrowRate,
    minBorrowRate: market.minBorrowRate,
    insuranceFund: { totalFactor: market.insuranceFund.totalFactor },
    poolId: market.poolId,
  };
}

/**
 * Parses a Drift spot market DTO.
 * @throws if an address string is invalid
 */
export function dtoToDriftSpotMarketRaw(dto: DriftSpotMarketJSON): DriftSpotMarket {
  return {
    pubkey: address(dto.pubkey),
    oracle: address(dto.oracle),
    mint: address(dto.mint),
    decimals: dto.decimals,
    marketIndex: dto.marketIndex,
    cumulativeDepositInterest: BigInt(dto.cumulativeDepositInterest),
    cumulativeBorrowInterest: BigInt(dto.cumulativeBorrowInterest),
    depositBalance: BigInt(dto.depositBalance),
    borrowBalance: BigInt(dto.borrowBalance),
    optimalUtilization: dto.optimalUtilization,
    optimalBorrowRate: dto.optimalBorrowRate,
    maxBorrowRate: dto.maxBorrowRate,
    minBorrowRate: dto.minBorrowRate,
    insuranceFund: { totalFactor: dto.insuranceFund.totalFactor },
    poolId: dto.poolId,
  };
}

/** Serializes a Drift user (or a decoded `User`) to its JSON DTO. */
export function driftUserRawToDto(user: DriftUser): DriftUserJSON {
  return {
    authority: user.authority,
    spotPositions: user.spotPositions.map(spotPositionToDto),
  };
}

/**
 * Parses a Drift user DTO.
 * @throws if an address string is invalid
 */
export function dtoToDriftUserRaw(dto: DriftUserJSON): DriftUser {
  return {
    authority: address(dto.authority),
    spotPositions: dto.spotPositions.map(dtoToSpotPosition),
  };
}

/** Serializes Drift rewards to their JSON DTO. */
export function driftRewardsRawToDto(rewards: DriftRewards): DriftRewardsJSON {
  return {
    oracle: rewards.oracle,
    marketIndex: rewards.marketIndex,
    spotMarket: rewards.spotMarket,
    mint: rewards.mint,
    spotPosition: spotPositionToDto(rewards.spotPosition),
  };
}

/**
 * Parses a Drift rewards DTO.
 * @throws if an address string is invalid
 */
export function dtoToDriftRewardsRaw(dto: DriftRewardsJSON): DriftRewards {
  return {
    oracle: address(dto.oracle),
    marketIndex: dto.marketIndex,
    spotMarket: address(dto.spotMarket),
    mint: address(dto.mint),
    spotPosition: dtoToSpotPosition(dto.spotPosition),
  };
}

/** Serializes Drift user stats (or a decoded `UserStats`) to their JSON DTO. */
export function driftUserStatsRawToDto(stats: DriftUserStats): DriftUserStatsJSON {
  return {
    authority: stats.authority,
    referrer: stats.referrer,
    fees: {
      totalFeePaid: stats.fees.totalFeePaid.toString(),
      totalFeeRebate: stats.fees.totalFeeRebate.toString(),
      totalTokenDiscount: stats.fees.totalTokenDiscount.toString(),
      totalRefereeDiscount: stats.fees.totalRefereeDiscount.toString(),
      totalReferrerReward: stats.fees.totalReferrerReward.toString(),
      currentEpochReferrerReward: stats.fees.currentEpochReferrerReward.toString(),
    },
    nextEpochTs: stats.nextEpochTs.toString(),
    makerVolume30d: stats.makerVolume30d.toString(),
    takerVolume30d: stats.takerVolume30d.toString(),
    fillerVolume30d: stats.fillerVolume30d.toString(),
    lastMakerVolume30dTs: stats.lastMakerVolume30dTs.toString(),
    lastTakerVolume30dTs: stats.lastTakerVolume30dTs.toString(),
    lastFillerVolume30dTs: stats.lastFillerVolume30dTs.toString(),
    ifStakedQuoteAssetAmount: stats.ifStakedQuoteAssetAmount.toString(),
    numberOfSubAccounts: stats.numberOfSubAccounts,
    numberOfSubAccountsCreated: stats.numberOfSubAccountsCreated,
    referrerStatus: stats.referrerStatus,
    disableUpdatePerpBidAskTwap: stats.disableUpdatePerpBidAskTwap,
    pausedOperations: stats.pausedOperations,
    fuelOverflowStatus: stats.fuelOverflowStatus,
    fuelInsurance: stats.fuelInsurance,
    fuelDeposits: stats.fuelDeposits,
    fuelBorrows: stats.fuelBorrows,
    fuelPositions: stats.fuelPositions,
    fuelTaker: stats.fuelTaker,
    fuelMaker: stats.fuelMaker,
    ifStakedGovTokenAmount: stats.ifStakedGovTokenAmount.toString(),
    lastFuelIfBonusUpdateTs: stats.lastFuelIfBonusUpdateTs,
    padding: [...stats.padding],
  };
}

/**
 * Parses a Drift user stats DTO.
 * @throws if an address string is invalid
 */
export function dtoToDriftUserStatsRaw(dto: DriftUserStatsJSON): DriftUserStats {
  return {
    authority: address(dto.authority),
    referrer: address(dto.referrer),
    fees: {
      totalFeePaid: BigInt(dto.fees.totalFeePaid),
      totalFeeRebate: BigInt(dto.fees.totalFeeRebate),
      totalTokenDiscount: BigInt(dto.fees.totalTokenDiscount),
      totalRefereeDiscount: BigInt(dto.fees.totalRefereeDiscount),
      totalReferrerReward: BigInt(dto.fees.totalReferrerReward),
      currentEpochReferrerReward: BigInt(dto.fees.currentEpochReferrerReward),
    },
    nextEpochTs: BigInt(dto.nextEpochTs),
    makerVolume30d: BigInt(dto.makerVolume30d),
    takerVolume30d: BigInt(dto.takerVolume30d),
    fillerVolume30d: BigInt(dto.fillerVolume30d),
    lastMakerVolume30dTs: BigInt(dto.lastMakerVolume30dTs),
    lastTakerVolume30dTs: BigInt(dto.lastTakerVolume30dTs),
    lastFillerVolume30dTs: BigInt(dto.lastFillerVolume30dTs),
    ifStakedQuoteAssetAmount: BigInt(dto.ifStakedQuoteAssetAmount),
    numberOfSubAccounts: dto.numberOfSubAccounts,
    numberOfSubAccountsCreated: dto.numberOfSubAccountsCreated,
    referrerStatus: dto.referrerStatus,
    disableUpdatePerpBidAskTwap: dto.disableUpdatePerpBidAskTwap,
    pausedOperations: dto.pausedOperations,
    fuelOverflowStatus: dto.fuelOverflowStatus,
    fuelInsurance: dto.fuelInsurance,
    fuelDeposits: dto.fuelDeposits,
    fuelBorrows: dto.fuelBorrows,
    fuelPositions: dto.fuelPositions,
    fuelTaker: dto.fuelTaker,
    fuelMaker: dto.fuelMaker,
    ifStakedGovTokenAmount: BigInt(dto.ifStakedGovTokenAmount),
    lastFuelIfBonusUpdateTs: dto.lastFuelIfBonusUpdateTs,
    padding: Uint8Array.from(dto.padding),
  };
}
