import { address } from "@solana/kit";

import {
  KaminoFarmState,
  KaminoFarmStateJSON,
  KaminoInterestRateBasis,
  KaminoObligation,
  KaminoObligationJSON,
  KaminoReserve,
  KaminoReserveJSON,
} from "./types";

/** Serializes a Kamino Obligation (or a decoded `Obligation`) to its JSON DTO. */
export function kaminoObligationToDto(obligation: KaminoObligation): KaminoObligationJSON {
  return {
    lendingMarket: obligation.lendingMarket,
    owner: obligation.owner,
    deposits: obligation.deposits.map((item) => ({
      depositReserve: item.depositReserve,
      depositedAmount: item.depositedAmount.toString(),
      marketValueSf: item.marketValueSf.toString(),
    })),
    borrows: obligation.borrows.map((item) => ({
      borrowReserve: item.borrowReserve,
      borrowedAmountSf: item.borrowedAmountSf.toString(),
      marketValueSf: item.marketValueSf.toString(),
    })),
  };
}

/**
 * Parses a Kamino Obligation DTO.
 * @throws if an address string is invalid
 */
export function dtoToKaminoObligation(dto: KaminoObligationJSON): KaminoObligation {
  return {
    lendingMarket: address(dto.lendingMarket),
    owner: address(dto.owner),
    // Hosted endpoints may prune empty position arrays from the payload
    deposits: (dto.deposits ?? []).map((item) => ({
      depositReserve: address(item.depositReserve),
      depositedAmount: BigInt(item.depositedAmount),
      marketValueSf: BigInt(item.marketValueSf),
    })),
    borrows: (dto.borrows ?? []).map((item) => ({
      borrowReserve: address(item.borrowReserve),
      borrowedAmountSf: BigInt(item.borrowedAmountSf),
      marketValueSf: BigInt(item.marketValueSf),
    })),
  };
}

/** Serializes a Kamino Reserve (or a decoded `Reserve`) to its JSON DTO. */
export function kaminoReserveToDto(reserve: KaminoReserve): KaminoReserveJSON {
  const { liquidity, collateral, config } = reserve;
  return {
    lendingMarket: reserve.lendingMarket,
    farmCollateral: reserve.farmCollateral,
    liquidity: {
      mintPubkey: liquidity.mintPubkey,
      supplyVault: liquidity.supplyVault,
      mintDecimals: liquidity.mintDecimals.toString(),
      totalAvailableAmount: liquidity.totalAvailableAmount.toString(),
      borrowedAmountSf: liquidity.borrowedAmountSf.toString(),
      accumulatedProtocolFeesSf: liquidity.accumulatedProtocolFeesSf.toString(),
      accumulatedReferrerFeesSf: liquidity.accumulatedReferrerFeesSf.toString(),
      pendingReferrerFeesSf: liquidity.pendingReferrerFeesSf.toString(),
    },
    collateral: {
      mintPubkey: collateral.mintPubkey,
      mintTotalSupply: collateral.mintTotalSupply.toString(),
      supplyVault: collateral.supplyVault,
    },
    withdrawQueue: {
      queuedCollateralAmount: reserve.withdrawQueue.queuedCollateralAmount.toString(),
    },
    config: {
      protocolTakeRatePct: config.protocolTakeRatePct,
      hostFixedInterestRateBps: config.hostFixedInterestRateBps,
      interestRateBasis: config.interestRateBasis ?? KaminoInterestRateBasis.Legacy,
      depositLimit: config.depositLimit.toString(),
      borrowLimit: config.borrowLimit.toString(),
      borrowRateCurve: {
        points: config.borrowRateCurve.points.map(({ utilizationRateBps, borrowRateBps }) => ({
          utilizationRateBps,
          borrowRateBps,
        })),
      },
      tokenInfo: {
        scopeConfiguration: { priceFeed: config.tokenInfo.scopeConfiguration.priceFeed },
        switchboardConfiguration: {
          priceAggregator: config.tokenInfo.switchboardConfiguration.priceAggregator,
          twapAggregator: config.tokenInfo.switchboardConfiguration.twapAggregator,
        },
        pythConfiguration: { price: config.tokenInfo.pythConfiguration.price },
      },
    },
  };
}

/**
 * Parses a Kamino Reserve DTO; a missing `interestRateBasis` becomes Legacy.
 * @throws if an address string is invalid
 */
export function dtoToKaminoReserve(dto: KaminoReserveJSON): KaminoReserve {
  const { liquidity, collateral, config } = dto;
  return {
    lendingMarket: address(dto.lendingMarket),
    farmCollateral: address(dto.farmCollateral),
    liquidity: {
      mintPubkey: address(liquidity.mintPubkey),
      supplyVault: address(liquidity.supplyVault),
      mintDecimals: BigInt(liquidity.mintDecimals),
      totalAvailableAmount: BigInt(liquidity.totalAvailableAmount),
      borrowedAmountSf: BigInt(liquidity.borrowedAmountSf),
      accumulatedProtocolFeesSf: BigInt(liquidity.accumulatedProtocolFeesSf),
      accumulatedReferrerFeesSf: BigInt(liquidity.accumulatedReferrerFeesSf),
      pendingReferrerFeesSf: BigInt(liquidity.pendingReferrerFeesSf),
    },
    collateral: {
      mintPubkey: address(collateral.mintPubkey),
      mintTotalSupply: BigInt(collateral.mintTotalSupply),
      supplyVault: address(collateral.supplyVault),
    },
    withdrawQueue: { queuedCollateralAmount: BigInt(dto.withdrawQueue.queuedCollateralAmount) },
    config: {
      protocolTakeRatePct: config.protocolTakeRatePct,
      hostFixedInterestRateBps: config.hostFixedInterestRateBps,
      interestRateBasis: config.interestRateBasis ?? KaminoInterestRateBasis.Legacy,
      depositLimit: BigInt(config.depositLimit),
      borrowLimit: BigInt(config.borrowLimit),
      borrowRateCurve: {
        points: config.borrowRateCurve.points.map(({ utilizationRateBps, borrowRateBps }) => ({
          utilizationRateBps,
          borrowRateBps,
        })),
      },
      tokenInfo: {
        scopeConfiguration: { priceFeed: address(config.tokenInfo.scopeConfiguration.priceFeed) },
        switchboardConfiguration: {
          priceAggregator: address(config.tokenInfo.switchboardConfiguration.priceAggregator),
          twapAggregator: address(config.tokenInfo.switchboardConfiguration.twapAggregator),
        },
        pythConfiguration: { price: address(config.tokenInfo.pythConfiguration.price) },
      },
    },
  };
}

/** Serializes a Kamino FarmState (or a decoded `FarmState`) to its JSON DTO. */
export function kaminoFarmStateToDto(farmState: KaminoFarmState): KaminoFarmStateJSON {
  return {
    token: { mint: farmState.token.mint, decimals: farmState.token.decimals.toString() },
    rewardInfos: farmState.rewardInfos.map((item) => ({
      token: { mint: item.token.mint, decimals: item.token.decimals.toString() },
      rewardsAvailable: item.rewardsAvailable.toString(),
      rewardsPerSecondDecimals: item.rewardsPerSecondDecimals,
      rewardScheduleCurve: {
        points: item.rewardScheduleCurve.points.map((point) => ({
          tsStart: point.tsStart.toString(),
          rewardPerTimeUnit: point.rewardPerTimeUnit.toString(),
        })),
      },
    })),
  };
}

/**
 * Parses a Kamino FarmState DTO.
 * @throws if an address string is invalid
 */
export function dtoToKaminoFarmState(dto: KaminoFarmStateJSON): KaminoFarmState {
  return {
    token: { mint: address(dto.token.mint), decimals: BigInt(dto.token.decimals) },
    rewardInfos: dto.rewardInfos.map((item) => ({
      token: { mint: address(item.token.mint), decimals: BigInt(item.token.decimals) },
      rewardsAvailable: BigInt(item.rewardsAvailable),
      rewardsPerSecondDecimals: item.rewardsPerSecondDecimals,
      rewardScheduleCurve: {
        points: item.rewardScheduleCurve.points.map((point) => ({
          tsStart: BigInt(point.tsStart),
          rewardPerTimeUnit: BigInt(point.rewardPerTimeUnit),
        })),
      },
    })),
  };
}
