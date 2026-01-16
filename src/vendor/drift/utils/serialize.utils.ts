import {
  DriftUserStats,
  DriftUserStatsJSON,
  UserFeesJSON,
  DriftUser,
  DriftUserJSON,
  DriftState,
  DriftStateJSON,
  DriftSpotMarket,
  DriftSpotMarketJSON,
  DriftSpotMarketRaw,
  DriftRewards,
  DriftRewardsJSON,
} from "../types";

export function driftUserStatsRawToDto(
  userStatsRaw: DriftUserStats
): DriftUserStatsJSON {
  return {
    authority: userStatsRaw.authority.toBase58(),
    referrer: userStatsRaw.referrer.toBase58(),
    fees: userFeesToDto(userStatsRaw.fees),
    nextEpochTs: userStatsRaw.nextEpochTs.toString(),
    makerVolume30d: userStatsRaw.makerVolume30d.toString(),
    takerVolume30d: userStatsRaw.takerVolume30d.toString(),
    fillerVolume30d: userStatsRaw.fillerVolume30d.toString(),
    lastMakerVolume30dTs: userStatsRaw.lastMakerVolume30dTs.toString(),
    lastTakerVolume30dTs: userStatsRaw.lastTakerVolume30dTs.toString(),
    lastFillerVolume30dTs: userStatsRaw.lastFillerVolume30dTs.toString(),
    ifStakedQuoteAssetAmount: userStatsRaw.ifStakedQuoteAssetAmount.toString(),
    numberOfSubAccounts: userStatsRaw.numberOfSubAccounts,
    numberOfSubAccountsCreated: userStatsRaw.numberOfSubAccountsCreated,
    referrerStatus: userStatsRaw.referrerStatus,
    disableUpdatePerpBidAskTwap: userStatsRaw.disableUpdatePerpBidAskTwap,
    padding1: userStatsRaw.padding1,
    fuelOverflowStatus: userStatsRaw.fuelOverflowStatus,
    fuelInsurance: userStatsRaw.fuelInsurance,
    fuelDeposits: userStatsRaw.fuelDeposits,
    fuelBorrows: userStatsRaw.fuelBorrows,
    fuelPositions: userStatsRaw.fuelPositions,
    fuelTaker: userStatsRaw.fuelTaker,
    fuelMaker: userStatsRaw.fuelMaker,
    ifStakedGovTokenAmount: userStatsRaw.ifStakedGovTokenAmount.toString(),
    lastFuelIfBonusUpdateTs: userStatsRaw.lastFuelIfBonusUpdateTs,
    padding: userStatsRaw.padding,
  };
}

export function driftUserRawToDto(userRaw: DriftUser): DriftUserJSON {
  return {
    authority: userRaw.authority.toBase58(),
    spotPositions: userRaw.spotPositions.map((p) => ({
      scaledBalance: p.scaledBalance?.toString() ?? "0",
      openBids: p.openBids?.toString() ?? "0",
      openAsks: p.openAsks?.toString() ?? "0",
      cumulativeDeposits: p.cumulativeDeposits?.toString() ?? "0",
      marketIndex: p.marketIndex ?? 0,
      balanceType: p.balanceType,
      openOrders: p.openOrders ?? 0,
      padding: p.padding ?? [],
    })),
  };
}

export function driftStateRawToDto(stateRaw: DriftState): DriftStateJSON {
  return {
    admin: stateRaw.admin.toBase58(),
    whitelistMint: stateRaw.whitelistMint.toBase58(),
    discountMint: stateRaw.discountMint.toBase58(),
    signer: stateRaw.signer.toBase58(),
    srmVault: stateRaw.srmVault.toBase58(),
    perpFeeStructure: stateRaw.perpFeeStructure as any,
    spotFeeStructure: stateRaw.spotFeeStructure as any,
    oracleGuardRails: stateRaw.oracleGuardRails as any,
    numberOfAuthorities: stateRaw.numberOfAuthorities.toString(),
    numberOfSubAccounts: stateRaw.numberOfSubAccounts.toString(),
    lpCooldownTime: stateRaw.lpCooldownTime.toString(),
    liquidationMarginBufferRatio: stateRaw.liquidationMarginBufferRatio,
    settlementDuration: stateRaw.settlementDuration,
    numberOfMarkets: stateRaw.numberOfMarkets,
    numberOfSpotMarkets: stateRaw.numberOfSpotMarkets,
    signerNonce: stateRaw.signerNonce,
    minPerpAuctionDuration: stateRaw.minPerpAuctionDuration,
    defaultMarketOrderTimeInForce: stateRaw.defaultMarketOrderTimeInForce,
    defaultSpotAuctionDuration: stateRaw.defaultSpotAuctionDuration,
    exchangeStatus: stateRaw.exchangeStatus,
    liquidationDuration: stateRaw.liquidationDuration,
    initialPctToLiquidate: stateRaw.initialPctToLiquidate,
    maxNumberOfSubAccounts: stateRaw.maxNumberOfSubAccounts,
    maxInitializeUserFee: stateRaw.maxInitializeUserFee,
    padding: stateRaw.padding,
  };
}

export function driftSpotMarketRawToDto(
  spotMarketRaw: DriftSpotMarket | DriftSpotMarketRaw
): DriftSpotMarketJSON {
  return {
    pubkey: spotMarketRaw.pubkey.toBase58(),
    oracle: spotMarketRaw.oracle.toBase58(),
    mint: spotMarketRaw.mint.toBase58(),
    decimals: spotMarketRaw.decimals,
    cumulativeDepositInterest:
      spotMarketRaw.cumulativeDepositInterest.toString(),
    marketIndex: spotMarketRaw.marketIndex,

    depositBalance: spotMarketRaw.depositBalance.toString(),
    borrowBalance: spotMarketRaw.borrowBalance.toString(),
    cumulativeBorrowInterest: spotMarketRaw.cumulativeBorrowInterest.toString(),
    optimalUtilization: spotMarketRaw.optimalUtilization,
    optimalBorrowRate: spotMarketRaw.optimalBorrowRate,
    maxBorrowRate: spotMarketRaw.maxBorrowRate,
    minBorrowRate: spotMarketRaw.minBorrowRate,
    insuranceFund: {
      totalFactor: spotMarketRaw.insuranceFund.totalFactor,
    },
  };
}

export function driftRewardsRawToDto(
  rewardsRaw: DriftRewards
): DriftRewardsJSON {
  return {
    oracle: rewardsRaw.oracle.toBase58(),
    marketIndex: rewardsRaw.marketIndex,
    spotMarket: rewardsRaw.spotMarket.toBase58(),
    mint: rewardsRaw.mint.toBase58(),
    spotPosition: {
      scaledBalance: rewardsRaw.spotPosition.scaledBalance.toString(),
      openBids: rewardsRaw.spotPosition.openBids.toString(),
      openAsks: rewardsRaw.spotPosition.openAsks.toString(),
      cumulativeDeposits: rewardsRaw.spotPosition.cumulativeDeposits.toString(),
      marketIndex: rewardsRaw.spotPosition.marketIndex,
      balanceType: rewardsRaw.spotPosition.balanceType,
      openOrders: rewardsRaw.spotPosition.openOrders,
      padding: rewardsRaw.spotPosition.padding,
    },
  };
}

function userFeesToDto(feesRaw: any): UserFeesJSON {
  return {
    totalFeePaid: feesRaw.totalFeePaid.toString(),
    totalFeeRebate: feesRaw.totalFeeRebate.toString(),
    totalTokenDiscount: feesRaw.totalTokenDiscount.toString(),
    totalRefereeDiscount: feesRaw.totalRefereeDiscount.toString(),
    totalReferrerReward: feesRaw.totalReferrerReward.toString(),
    currentEpochReferrerReward: feesRaw.currentEpochReferrerReward.toString(),
  };
}
