import {
  KaminoReserve,
  KaminoReserveDto,
  ObligationCollateralFields,
  ObligationCollateralJSON,
  ObligationJSON,
  ObligationLiquidityFields,
  ObligationLiquidityJSON,
  ObligationOrderFields,
  ObligationOrderJSON,
  ObligationRaw,
  ReserveRaw,
} from "../../types";

/**
 * Project a full {@link ReserveRaw} into the slim {@link KaminoReserve}
 * containing only the fields the app reads.
 */
export function kaminoReserveFromRaw(raw: ReserveRaw): KaminoReserve {
  return {
    lendingMarket: raw.lendingMarket,
    farmCollateral: raw.farmCollateral,
    liquidity: {
      mintPubkey: raw.liquidity.mintPubkey,
      mintDecimals: raw.liquidity.mintDecimals,
      availableAmount: raw.liquidity.availableAmount,
      borrowedAmountSf: raw.liquidity.borrowedAmountSf,
      accumulatedProtocolFeesSf: raw.liquidity.accumulatedProtocolFeesSf,
      accumulatedReferrerFeesSf: raw.liquidity.accumulatedReferrerFeesSf,
      pendingReferrerFeesSf: raw.liquidity.pendingReferrerFeesSf,
      supplyVault: raw.liquidity.supplyVault,
    },
    collateral: {
      mintPubkey: raw.collateral.mintPubkey,
      mintTotalSupply: raw.collateral.mintTotalSupply,
      supplyVault: raw.collateral.supplyVault,
    },
    config: {
      hostFixedInterestRateBps: raw.config.hostFixedInterestRateBps,
      protocolTakeRatePct: raw.config.protocolTakeRatePct,
      borrowRateCurve: {
        points: raw.config.borrowRateCurve.points.map((p) => ({
          utilizationRateBps: p.utilizationRateBps,
          borrowRateBps: p.borrowRateBps,
        })),
      },
      depositLimit: raw.config.depositLimit,
      borrowLimit: raw.config.borrowLimit,
      tokenInfo: {
        pythConfiguration: {
          price: raw.config.tokenInfo.pythConfiguration.price,
        },
        switchboardConfiguration: {
          priceAggregator: raw.config.tokenInfo.switchboardConfiguration.priceAggregator,
          twapAggregator: raw.config.tokenInfo.switchboardConfiguration.twapAggregator,
        },
        scopeConfiguration: {
          priceFeed: raw.config.tokenInfo.scopeConfiguration.priceFeed,
        },
      },
    },
  };
}

export function kaminoReserveToDto(reserve: KaminoReserve): KaminoReserveDto {
  return {
    lendingMarket: reserve.lendingMarket.toBase58(),
    farmCollateral: reserve.farmCollateral.toBase58(),
    liquidity: {
      mintPubkey: reserve.liquidity.mintPubkey.toBase58(),
      mintDecimals: reserve.liquidity.mintDecimals.toString(),
      availableAmount: reserve.liquidity.availableAmount.toString(),
      borrowedAmountSf: reserve.liquidity.borrowedAmountSf.toString(),
      accumulatedProtocolFeesSf: reserve.liquidity.accumulatedProtocolFeesSf.toString(),
      accumulatedReferrerFeesSf: reserve.liquidity.accumulatedReferrerFeesSf.toString(),
      pendingReferrerFeesSf: reserve.liquidity.pendingReferrerFeesSf.toString(),
      supplyVault: reserve.liquidity.supplyVault.toBase58(),
    },
    collateral: {
      mintPubkey: reserve.collateral.mintPubkey.toBase58(),
      mintTotalSupply: reserve.collateral.mintTotalSupply.toString(),
      supplyVault: reserve.collateral.supplyVault.toBase58(),
    },
    config: {
      hostFixedInterestRateBps: reserve.config.hostFixedInterestRateBps,
      protocolTakeRatePct: reserve.config.protocolTakeRatePct,
      borrowRateCurve: {
        points: reserve.config.borrowRateCurve.points.map((p) => ({
          utilizationRateBps: p.utilizationRateBps,
          borrowRateBps: p.borrowRateBps,
        })),
      },
      depositLimit: reserve.config.depositLimit.toString(),
      borrowLimit: reserve.config.borrowLimit.toString(),
      tokenInfo: {
        pythConfiguration: {
          price: reserve.config.tokenInfo.pythConfiguration.price.toBase58(),
        },
        switchboardConfiguration: {
          priceAggregator:
            reserve.config.tokenInfo.switchboardConfiguration.priceAggregator.toBase58(),
          twapAggregator:
            reserve.config.tokenInfo.switchboardConfiguration.twapAggregator.toBase58(),
        },
        scopeConfiguration: {
          priceFeed: reserve.config.tokenInfo.scopeConfiguration.priceFeed.toBase58(),
        },
      },
    },
  };
}

export function obligationRawToDto(obligationRaw: ObligationRaw): ObligationJSON {
  return {
    tag: obligationRaw.tag.toString(),
    lastUpdate: {
      slot: obligationRaw.lastUpdate.slot.toString(),
      stale: obligationRaw.lastUpdate.stale,
      priceStatus: obligationRaw.lastUpdate.priceStatus,
      placeholder: obligationRaw.lastUpdate.placeholder,
    },
    lendingMarket: obligationRaw.lendingMarket.toBase58(),
    owner: obligationRaw.owner.toBase58(),
    deposits: obligationRaw.deposits.map((item) => obligationCollateralToDto(item)),
    lowestReserveDepositLiquidationLtv: obligationRaw.lowestReserveDepositLiquidationLtv.toString(),
    depositedValueSf: obligationRaw.depositedValueSf.toString(),
    borrows: obligationRaw.borrows.map((item) => obligationLiquidityToDto(item)),
    borrowFactorAdjustedDebtValueSf: obligationRaw.borrowFactorAdjustedDebtValueSf.toString(),
    borrowedAssetsMarketValueSf: obligationRaw.borrowedAssetsMarketValueSf.toString(),
    allowedBorrowValueSf: obligationRaw.allowedBorrowValueSf.toString(),
    unhealthyBorrowValueSf: obligationRaw.unhealthyBorrowValueSf.toString(),
    depositsAssetTiers: obligationRaw.depositsAssetTiers,
    borrowsAssetTiers: obligationRaw.borrowsAssetTiers,
    elevationGroup: obligationRaw.elevationGroup,
    numOfObsoleteDepositReserves: obligationRaw.numOfObsoleteDepositReserves,
    hasDebt: obligationRaw.hasDebt,
    referrer: obligationRaw.referrer.toBase58(),
    borrowingDisabled: obligationRaw.borrowingDisabled,
    autodeleverageTargetLtvPct: obligationRaw.autodeleverageTargetLtvPct,
    lowestReserveDepositMaxLtvPct: obligationRaw.lowestReserveDepositMaxLtvPct,
    numOfObsoleteBorrowReserves: obligationRaw.numOfObsoleteBorrowReserves,
    reserved: obligationRaw.reserved,
    highestBorrowFactorPct: obligationRaw.highestBorrowFactorPct.toString(),
    autodeleverageMarginCallStartedTimestamp:
      obligationRaw.autodeleverageMarginCallStartedTimestamp.toString(),
    orders: obligationRaw.orders.map((item) => obligationOrderToDto(item)),
    padding3: obligationRaw.padding3.map((item) => item.toString()),
  };
}

function obligationCollateralToDto(
  obligationCollateralFields: ObligationCollateralFields
): ObligationCollateralJSON {
  return {
    depositReserve: obligationCollateralFields.depositReserve.toBase58(),
    depositedAmount: obligationCollateralFields.depositedAmount.toString(),
    marketValueSf: obligationCollateralFields.marketValueSf.toString(),
    borrowedAmountAgainstThisCollateralInElevationGroup:
      obligationCollateralFields.borrowedAmountAgainstThisCollateralInElevationGroup.toString(),
    padding: obligationCollateralFields.padding.map((item) => item.toString()),
  };
}

function obligationLiquidityToDto(
  obligationLiquidityFields: ObligationLiquidityFields
): ObligationLiquidityJSON {
  return {
    borrowReserve: obligationLiquidityFields.borrowReserve.toBase58(),
    cumulativeBorrowRateBsf: {
      value: obligationLiquidityFields.cumulativeBorrowRateBsf.value.map((item) => item.toString()),
      padding: obligationLiquidityFields.cumulativeBorrowRateBsf.padding.map((item) =>
        item.toString()
      ),
    },
    padding: obligationLiquidityFields.padding.toString(),
    borrowedAmountSf: obligationLiquidityFields.borrowedAmountSf.toString(),
    marketValueSf: obligationLiquidityFields.marketValueSf.toString(),
    borrowFactorAdjustedMarketValueSf:
      obligationLiquidityFields.borrowFactorAdjustedMarketValueSf.toString(),
    borrowedAmountOutsideElevationGroups:
      obligationLiquidityFields.borrowedAmountOutsideElevationGroups.toString(),
    padding2: obligationLiquidityFields.padding2.map((item) => item.toString()),
  };
}

function obligationOrderToDto(obligationOrderFields: ObligationOrderFields): ObligationOrderJSON {
  return {
    conditionThresholdSf: obligationOrderFields.conditionThresholdSf.toString(),
    opportunityParameterSf: obligationOrderFields.opportunityParameterSf.toString(),
    minExecutionBonusBps: obligationOrderFields.minExecutionBonusBps,
    maxExecutionBonusBps: obligationOrderFields.maxExecutionBonusBps,
    conditionType: obligationOrderFields.conditionType,
    opportunityType: obligationOrderFields.opportunityType,
    padding1: obligationOrderFields.padding1,
    padding2: obligationOrderFields.padding2.map((item) => item.toString()),
  };
}
