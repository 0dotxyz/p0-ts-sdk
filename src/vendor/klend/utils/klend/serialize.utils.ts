import {
  ObligationCollateralFields,
  ObligationCollateralJSON,
  ObligationJSON,
  ObligationLiquidityFields,
  ObligationLiquidityJSON,
  ObligationOrderFields,
  ObligationOrderJSON,
  ObligationRaw,
  ReserveConfigFields,
  ReserveConfigJSON,
  ReserveJSON,
  ReserveLiquidityFields,
  ReserveLiquidityJSON,
  ReserveRaw,
  TokenInfoFields,
  TokenInfoJSON,
  WithdrawalCapsFields,
  WithdrawalCapsJSON,
} from "../../types";

export function obligationRawToDto(
  obligationRaw: ObligationRaw
): ObligationJSON {
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
    deposits: obligationRaw.deposits.map((item) =>
      obligationCollateralToDto(item)
    ),
    lowestReserveDepositLiquidationLtv:
      obligationRaw.lowestReserveDepositLiquidationLtv.toString(),
    depositedValueSf: obligationRaw.depositedValueSf.toString(),
    borrows: obligationRaw.borrows.map((item) =>
      obligationLiquidityToDto(item)
    ),
    borrowFactorAdjustedDebtValueSf:
      obligationRaw.borrowFactorAdjustedDebtValueSf.toString(),
    borrowedAssetsMarketValueSf:
      obligationRaw.borrowedAssetsMarketValueSf.toString(),
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

export function reserveRawToDto(reserveRaw: ReserveRaw): ReserveJSON {
  return {
    version: reserveRaw.version.toString(),
    lastUpdate: {
      slot: reserveRaw.lastUpdate.slot.toString(),
      stale: reserveRaw.lastUpdate.stale,
      priceStatus: reserveRaw.lastUpdate.priceStatus,
      placeholder: reserveRaw.lastUpdate.placeholder,
    },
    lendingMarket: reserveRaw.lendingMarket.toBase58(),
    farmCollateral: reserveRaw.farmCollateral.toBase58(),
    farmDebt: reserveRaw.farmDebt.toBase58(),
    liquidity: reserveLiquidityFieldsToDto(reserveRaw.liquidity),
    reserveLiquidityPadding: reserveRaw.reserveLiquidityPadding.map((item) =>
      item.toString()
    ),
    collateral: {
      mintPubkey: reserveRaw.collateral.mintPubkey.toBase58(),
      mintTotalSupply: reserveRaw.collateral.mintTotalSupply.toString(),
      supplyVault: reserveRaw.collateral.supplyVault.toBase58(),
      padding1: reserveRaw.collateral.padding1.map((item) => item.toString()),
      padding2: reserveRaw.collateral.padding2.map((item) => item.toString()),
    },
    reserveCollateralPadding: reserveRaw.reserveCollateralPadding.map((item) =>
      item.toString()
    ),
    config: reserveConfigFieldsToDto(reserveRaw.config),
    configPadding: reserveRaw.configPadding.map((item) => item.toString()),
    borrowedAmountOutsideElevationGroup:
      reserveRaw.borrowedAmountOutsideElevationGroup.toString(),
    borrowedAmountsAgainstThisReserveInElevationGroups:
      reserveRaw.borrowedAmountsAgainstThisReserveInElevationGroups.map(
        (item) => item.toString()
      ),
    padding: reserveRaw.padding.map((item) => item.toString()),
  };
}

function reserveLiquidityFieldsToDto(
  reserveLiquidityFields: ReserveLiquidityFields
): ReserveLiquidityJSON {
  return {
    mintPubkey: reserveLiquidityFields.mintPubkey.toBase58(),
    supplyVault: reserveLiquidityFields.supplyVault.toBase58(),
    feeVault: reserveLiquidityFields.feeVault.toBase58(),
    availableAmount: reserveLiquidityFields.availableAmount.toString(),
    borrowedAmountSf: reserveLiquidityFields.borrowedAmountSf.toString(),
    marketPriceSf: reserveLiquidityFields.marketPriceSf.toString(),
    marketPriceLastUpdatedTs:
      reserveLiquidityFields.marketPriceLastUpdatedTs.toString(),
    mintDecimals: reserveLiquidityFields.mintDecimals.toString(),
    depositLimitCrossedTimestamp:
      reserveLiquidityFields.depositLimitCrossedTimestamp.toString(),
    borrowLimitCrossedTimestamp:
      reserveLiquidityFields.borrowLimitCrossedTimestamp.toString(),
    cumulativeBorrowRateBsf: {
      value: reserveLiquidityFields.cumulativeBorrowRateBsf.value.map((item) =>
        item.toString()
      ),
      padding: reserveLiquidityFields.cumulativeBorrowRateBsf.padding.map(
        (item) => item.toString()
      ),
    },
    accumulatedProtocolFeesSf:
      reserveLiquidityFields.accumulatedProtocolFeesSf.toString(),
    accumulatedReferrerFeesSf:
      reserveLiquidityFields.accumulatedReferrerFeesSf.toString(),
    pendingReferrerFeesSf:
      reserveLiquidityFields.pendingReferrerFeesSf.toString(),
    absoluteReferralRateSf:
      reserveLiquidityFields.absoluteReferralRateSf.toString(),
    tokenProgram: reserveLiquidityFields.tokenProgram.toBase58(),
    padding2: reserveLiquidityFields.padding2.map((item) => item.toString()),
    padding3: reserveLiquidityFields.padding3.map((item) => item.toString()),
  };
}

function reserveConfigFieldsToDto(
  reserveConfigFields: ReserveConfigFields
): ReserveConfigJSON {
  return {
    status: reserveConfigFields.status,
    assetTier: reserveConfigFields.assetTier,
    hostFixedInterestRateBps: reserveConfigFields.hostFixedInterestRateBps,
    reserved2: reserveConfigFields.reserved2,
    protocolOrderExecutionFeePct:
      reserveConfigFields.protocolOrderExecutionFeePct,
    protocolTakeRatePct: reserveConfigFields.protocolTakeRatePct,
    protocolLiquidationFeePct: reserveConfigFields.protocolLiquidationFeePct,
    loanToValuePct: reserveConfigFields.loanToValuePct,
    liquidationThresholdPct: reserveConfigFields.liquidationThresholdPct,
    minLiquidationBonusBps: reserveConfigFields.minLiquidationBonusBps,
    maxLiquidationBonusBps: reserveConfigFields.maxLiquidationBonusBps,
    badDebtLiquidationBonusBps: reserveConfigFields.badDebtLiquidationBonusBps,
    deleveragingMarginCallPeriodSecs:
      reserveConfigFields.deleveragingMarginCallPeriodSecs.toString(),
    deleveragingThresholdDecreaseBpsPerDay:
      reserveConfigFields.deleveragingThresholdDecreaseBpsPerDay.toString(),
    fees: {
      borrowFeeSf: reserveConfigFields.fees.borrowFeeSf.toString(),
      flashLoanFeeSf: reserveConfigFields.fees.flashLoanFeeSf.toString(),
      padding: reserveConfigFields.fees.padding,
    },
    borrowRateCurve: {
      points: reserveConfigFields.borrowRateCurve.points.map((item) => ({
        utilizationRateBps: item.utilizationRateBps,
        borrowRateBps: item.borrowRateBps,
      })),
    },
    borrowFactorPct: reserveConfigFields.borrowFactorPct.toString(),
    depositLimit: reserveConfigFields.depositLimit.toString(),
    borrowLimit: reserveConfigFields.borrowLimit.toString(),
    tokenInfo: tokenInfoFieldsToDto(reserveConfigFields.tokenInfo),
    depositWithdrawalCap: withdrawalCapsFieldsToDto(
      reserveConfigFields.depositWithdrawalCap
    ),
    debtWithdrawalCap: withdrawalCapsFieldsToDto(
      reserveConfigFields.debtWithdrawalCap
    ),
    elevationGroups: reserveConfigFields.elevationGroups,
    disableUsageAsCollOutsideEmode:
      reserveConfigFields.disableUsageAsCollOutsideEmode,
    utilizationLimitBlockBorrowingAbovePct:
      reserveConfigFields.utilizationLimitBlockBorrowingAbovePct,
    autodeleverageEnabled: reserveConfigFields.autodeleverageEnabled,
    reserved1: reserveConfigFields.reserved1,
    borrowLimitOutsideElevationGroup:
      reserveConfigFields.borrowLimitOutsideElevationGroup.toString(),
    borrowLimitAgainstThisCollateralInElevationGroup:
      reserveConfigFields.borrowLimitAgainstThisCollateralInElevationGroup.map(
        (item) => item.toString()
      ),
    deleveragingBonusIncreaseBpsPerDay:
      reserveConfigFields.deleveragingBonusIncreaseBpsPerDay.toString(),
  };
}

function tokenInfoFieldsToDto(tokenInfoFields: TokenInfoFields): TokenInfoJSON {
  return {
    name: tokenInfoFields.name,
    heuristic: {
      lower: tokenInfoFields.heuristic.lower.toString(),
      upper: tokenInfoFields.heuristic.upper.toString(),
      exp: tokenInfoFields.heuristic.exp.toString(),
    },
    maxTwapDivergenceBps: tokenInfoFields.maxTwapDivergenceBps.toString(),
    maxAgePriceSeconds: tokenInfoFields.maxAgePriceSeconds.toString(),
    maxAgeTwapSeconds: tokenInfoFields.maxAgeTwapSeconds.toString(),
    scopeConfiguration: {
      priceFeed: tokenInfoFields.scopeConfiguration.priceFeed.toBase58(),
      priceChain: tokenInfoFields.scopeConfiguration.priceChain,
      twapChain: tokenInfoFields.scopeConfiguration.twapChain,
    },
    switchboardConfiguration: {
      priceAggregator:
        tokenInfoFields.switchboardConfiguration.priceAggregator.toBase58(),
      twapAggregator:
        tokenInfoFields.switchboardConfiguration.twapAggregator.toBase58(),
    },
    pythConfiguration: {
      price: tokenInfoFields.pythConfiguration.price.toBase58(),
    },
    blockPriceUsage: tokenInfoFields.blockPriceUsage,
    reserved: tokenInfoFields.reserved,
    padding: tokenInfoFields.padding.map((item) => item.toString()),
  };
}

function withdrawalCapsFieldsToDto(
  withdrawalCapsFields: WithdrawalCapsFields
): WithdrawalCapsJSON {
  return {
    configCapacity: withdrawalCapsFields.configCapacity.toString(),
    currentTotal: withdrawalCapsFields.currentTotal.toString(),
    lastIntervalStartTimestamp:
      withdrawalCapsFields.lastIntervalStartTimestamp.toString(),
    configIntervalLengthSeconds:
      withdrawalCapsFields.configIntervalLengthSeconds.toString(),
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
      value: obligationLiquidityFields.cumulativeBorrowRateBsf.value.map(
        (item) => item.toString()
      ),
      padding: obligationLiquidityFields.cumulativeBorrowRateBsf.padding.map(
        (item) => item.toString()
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

function obligationOrderToDto(
  obligationOrderFields: ObligationOrderFields
): ObligationOrderJSON {
  return {
    conditionThresholdSf: obligationOrderFields.conditionThresholdSf.toString(),
    opportunityParameterSf:
      obligationOrderFields.opportunityParameterSf.toString(),
    minExecutionBonusBps: obligationOrderFields.minExecutionBonusBps,
    maxExecutionBonusBps: obligationOrderFields.maxExecutionBonusBps,
    conditionType: obligationOrderFields.conditionType,
    opportunityType: obligationOrderFields.opportunityType,
    padding1: obligationOrderFields.padding1,
    padding2: obligationOrderFields.padding2.map((item) => item.toString()),
  };
}
