import BN from "bn.js";
import { PublicKey } from "@solana/web3.js";
import { BorshAccountsCoder } from "@coral-xyz/anchor";
import {
  DriftUserStats,
  DriftUserStatsJSON,
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
import { DRIFT_IDL } from "../idl";

const DRIFT_ACCOUNTS_CODER = new BorshAccountsCoder(DRIFT_IDL);

const spotMarketDiscriminator = Buffer.from([
  100, 177, 8, 107, 168, 65, 65, 39,
]);
const stateDiscriminator = Buffer.from([216, 146, 107, 94, 104, 75, 182, 177]);
const userDiscriminator = Buffer.from([159, 117, 95, 227, 239, 151, 58, 236]);
const userStatsDiscriminator = Buffer.from([
  176, 223, 136, 27, 122, 79, 32, 227,
]);

export function dtoToDriftUserStatsRaw(
  userStatsDto: DriftUserStatsJSON
): DriftUserStats {
  return {
    authority: new PublicKey(userStatsDto.authority),
    referrer: new PublicKey(userStatsDto.referrer),
    fees: {
      totalFeePaid: new BN(userStatsDto.fees.totalFeePaid),
      totalFeeRebate: new BN(userStatsDto.fees.totalFeeRebate),
      totalTokenDiscount: new BN(userStatsDto.fees.totalTokenDiscount),
      totalRefereeDiscount: new BN(userStatsDto.fees.totalRefereeDiscount),
      totalReferrerReward: new BN(userStatsDto.fees.totalReferrerReward),
      currentEpochReferrerReward: new BN(
        userStatsDto.fees.currentEpochReferrerReward
      ),
    },
    nextEpochTs: new BN(userStatsDto.nextEpochTs),
    makerVolume30d: new BN(userStatsDto.makerVolume30d),
    takerVolume30d: new BN(userStatsDto.takerVolume30d),
    fillerVolume30d: new BN(userStatsDto.fillerVolume30d),
    lastMakerVolume30dTs: new BN(userStatsDto.lastMakerVolume30dTs),
    lastTakerVolume30dTs: new BN(userStatsDto.lastTakerVolume30dTs),
    lastFillerVolume30dTs: new BN(userStatsDto.lastFillerVolume30dTs),
    ifStakedQuoteAssetAmount: new BN(userStatsDto.ifStakedQuoteAssetAmount),
    numberOfSubAccounts: userStatsDto.numberOfSubAccounts,
    numberOfSubAccountsCreated: userStatsDto.numberOfSubAccountsCreated,
    referrerStatus: userStatsDto.referrerStatus,
    disableUpdatePerpBidAskTwap: userStatsDto.disableUpdatePerpBidAskTwap,
    padding1: userStatsDto.padding1,
    fuelOverflowStatus: userStatsDto.fuelOverflowStatus,
    fuelInsurance: userStatsDto.fuelInsurance,
    fuelDeposits: userStatsDto.fuelDeposits,
    fuelBorrows: userStatsDto.fuelBorrows,
    fuelPositions: userStatsDto.fuelPositions,
    fuelTaker: userStatsDto.fuelTaker,
    fuelMaker: userStatsDto.fuelMaker,
    ifStakedGovTokenAmount: new BN(userStatsDto.ifStakedGovTokenAmount),
    lastFuelIfBonusUpdateTs: userStatsDto.lastFuelIfBonusUpdateTs,
    padding: userStatsDto.padding,
  };
}

export function dtoToDriftUserRaw(userDto: DriftUserJSON): DriftUser {
  return {
    authority: new PublicKey(userDto.authority),
    spotPositions: userDto.spotPositions.map((p) => ({
      scaledBalance: new BN(p.scaledBalance),
      openBids: new BN(p.openBids),
      openAsks: new BN(p.openAsks),
      cumulativeDeposits: new BN(p.cumulativeDeposits),
      marketIndex: p.marketIndex,
      balanceType: p.balanceType,
      openOrders: p.openOrders,
      padding: p.padding,
    })),
  };
}

export function dtoToDriftStateRaw(stateDto: DriftStateJSON): DriftState {
  return {
    admin: new PublicKey(stateDto.admin),
    whitelistMint: new PublicKey(stateDto.whitelistMint),
    discountMint: new PublicKey(stateDto.discountMint),
    signer: new PublicKey(stateDto.signer),
    srmVault: new PublicKey(stateDto.srmVault),
    perpFeeStructure: stateDto.perpFeeStructure as any,
    spotFeeStructure: stateDto.spotFeeStructure as any,
    oracleGuardRails: stateDto.oracleGuardRails as any,
    numberOfAuthorities: new BN(stateDto.numberOfAuthorities),
    numberOfSubAccounts: new BN(stateDto.numberOfSubAccounts),
    lpCooldownTime: new BN(stateDto.lpCooldownTime),
    liquidationMarginBufferRatio: stateDto.liquidationMarginBufferRatio,
    settlementDuration: stateDto.settlementDuration,
    numberOfMarkets: stateDto.numberOfMarkets,
    numberOfSpotMarkets: stateDto.numberOfSpotMarkets,
    signerNonce: stateDto.signerNonce,
    minPerpAuctionDuration: stateDto.minPerpAuctionDuration,
    defaultMarketOrderTimeInForce: stateDto.defaultMarketOrderTimeInForce,
    defaultSpotAuctionDuration: stateDto.defaultSpotAuctionDuration,
    exchangeStatus: stateDto.exchangeStatus,
    liquidationDuration: stateDto.liquidationDuration,
    initialPctToLiquidate: stateDto.initialPctToLiquidate,
    maxNumberOfSubAccounts: stateDto.maxNumberOfSubAccounts,
    maxInitializeUserFee: stateDto.maxInitializeUserFee,
    padding: stateDto.padding,
  };
}

export function dtoToDriftRewardsRaw(
  rewardsDto: DriftRewardsJSON
): DriftRewards {
  return {
    oracle: new PublicKey(rewardsDto.oracle),
    marketIndex: rewardsDto.marketIndex,
    spotMarket: new PublicKey(rewardsDto.spotMarket),
    mint: new PublicKey(rewardsDto.mint),
    spotPosition: {
      scaledBalance: new BN(rewardsDto.spotPosition.scaledBalance),
      openBids: new BN(rewardsDto.spotPosition.openBids),
      openAsks: new BN(rewardsDto.spotPosition.openAsks),
      cumulativeDeposits: new BN(rewardsDto.spotPosition.cumulativeDeposits),
      marketIndex: rewardsDto.spotPosition.marketIndex,
      balanceType: rewardsDto.spotPosition.balanceType,
      openOrders: rewardsDto.spotPosition.openOrders,
      padding: rewardsDto.spotPosition.padding,
    },
  };
}

export function dtoToDriftSpotMarketRaw(
  spotMarketDto: DriftSpotMarketJSON
): DriftSpotMarket {
  return {
    pubkey: new PublicKey(spotMarketDto.pubkey),
    oracle: new PublicKey(spotMarketDto.oracle),
    mint: new PublicKey(spotMarketDto.mint),
    decimals: spotMarketDto.decimals,
    cumulativeDepositInterest: new BN(spotMarketDto.cumulativeDepositInterest),
    marketIndex: spotMarketDto.marketIndex,
    depositBalance: new BN(spotMarketDto.depositBalance),
    borrowBalance: new BN(spotMarketDto.borrowBalance),
    cumulativeBorrowInterest: new BN(spotMarketDto.cumulativeBorrowInterest),
    optimalUtilization: spotMarketDto.optimalUtilization,
    optimalBorrowRate: spotMarketDto.optimalBorrowRate,
    maxBorrowRate: spotMarketDto.maxBorrowRate,
    minBorrowRate: spotMarketDto.minBorrowRate,
    insuranceFund: spotMarketDto.insuranceFund,
  };
}

export function decodeDriftSpotMarketData(data: Buffer): DriftSpotMarketRaw {
  if (!data.slice(0, 8).equals(spotMarketDiscriminator)) {
    throw new Error("invalid account discriminator");
  }

  // BorshAccountsCoder.decode() expects the full buffer with discriminator
  const decoded = DRIFT_ACCOUNTS_CODER.decode("SpotMarket", data) as any;

  // Transform snake_case field names from IDL to camelCase for TypeScript types
  return {
    pubkey: decoded.pubkey,
    oracle: decoded.oracle,
    mint: decoded.mint,
    vault: decoded.vault,
    name: decoded.name,
    historicalOracleData: decoded.historical_oracle_data,
    historicalIndexData: decoded.historical_index_data,
    revenuePool: decoded.revenue_pool,
    spotFeePool: decoded.spot_fee_pool,
    insuranceFund: decoded.insurance_fund,
    totalSpotFee: decoded.total_spot_fee,
    depositBalance: decoded.deposit_balance,
    borrowBalance: decoded.borrow_balance,
    cumulativeDepositInterest: decoded.cumulative_deposit_interest,
    cumulativeBorrowInterest: decoded.cumulative_borrow_interest,
    totalSocialLoss: decoded.total_social_loss,
    totalQuoteSocialLoss: decoded.total_quote_social_loss,
    withdrawGuardThreshold: decoded.withdraw_guard_threshold,
    maxTokenDeposits: decoded.max_token_deposits,
    depositTokenTwap: decoded.deposit_token_twap,
    borrowTokenTwap: decoded.borrow_token_twap,
    utilizationTwap: decoded.utilization_twap,
    lastInterestTs: decoded.last_interest_ts,
    lastTwapTs: decoded.last_twap_ts,
    expiryTs: decoded.expiry_ts,
    orderStepSize: decoded.order_step_size,
    orderTickSize: decoded.order_tick_size,
    minOrderSize: decoded.min_order_size,
    maxPositionSize: decoded.max_position_size,
    nextFillRecordId: decoded.next_fill_record_id,
    nextDepositRecordId: decoded.next_deposit_record_id,
    initialAssetWeight: decoded.initial_asset_weight,
    maintenanceAssetWeight: decoded.maintenance_asset_weight,
    initialLiabilityWeight: decoded.initial_liability_weight,
    maintenanceLiabilityWeight: decoded.maintenance_liability_weight,
    imfFactor: decoded.imf_factor,
    liquidatorFee: decoded.liquidator_fee,
    ifLiquidationFee: decoded.if_liquidation_fee,
    optimalUtilization: decoded.optimal_utilization,
    optimalBorrowRate: decoded.optimal_borrow_rate,
    maxBorrowRate: decoded.max_borrow_rate,
    decimals: decoded.decimals,
    marketIndex: decoded.market_index,
    ordersEnabled: decoded.orders_enabled,
    oracleSource: decoded.oracle_source,
    status: decoded.status,
    assetTier: decoded.asset_tier,
    pausedOperations: decoded.paused_operations,
    ifPausedOperations: decoded.if_paused_operations,
    feeAdjustment: decoded.fee_adjustment,
    maxTokenBorrowsFraction: decoded.max_token_borrows_fraction,
    flashLoanAmount: decoded.flash_loan_amount,
    flashLoanInitialTokenAmount: decoded.flash_loan_initial_token_amount,
    totalSwapFee: decoded.total_swap_fee,
    scaleInitialAssetWeightStart: decoded.scale_initial_asset_weight_start,
    minBorrowRate: decoded.min_borrow_rate,
    fuelBoostDeposits: decoded.fuel_boost_deposits,
    fuelBoostBorrows: decoded.fuel_boost_borrows,
    fuelBoostTaker: decoded.fuel_boost_taker,
    fuelBoostMaker: decoded.fuel_boost_maker,
    fuelBoostInsurance: decoded.fuel_boost_insurance,
    tokenProgram: decoded.token_program,
    poolId: decoded.pool_id,
    padding: decoded.padding,
  } as DriftSpotMarketRaw;
}

export function decodeDriftStateData(data: Buffer): DriftState {
  if (!data.slice(0, 8).equals(stateDiscriminator)) {
    throw new Error("invalid account discriminator");
  }

  const decoded = DRIFT_ACCOUNTS_CODER.decode("State", data) as any;

  // Transform snake_case field names from IDL to camelCase for TypeScript types
  return {
    admin: decoded.admin,
    whitelistMint: decoded.whitelist_mint,
    discountMint: decoded.discount_mint,
    signer: decoded.signer,
    srmVault: decoded.srm_vault,
    perpFeeStructure: decoded.perp_fee_structure,
    spotFeeStructure: decoded.spot_fee_structure,
    oracleGuardRails: decoded.oracle_guard_rails,
    numberOfAuthorities: decoded.number_of_authorities,
    numberOfSubAccounts: decoded.number_of_sub_accounts,
    lpCooldownTime: decoded.lp_cooldown_time,
    liquidationMarginBufferRatio: decoded.liquidation_margin_buffer_ratio,
    settlementDuration: decoded.settlement_duration,
    numberOfMarkets: decoded.number_of_markets,
    numberOfSpotMarkets: decoded.number_of_spot_markets,
    signerNonce: decoded.signer_nonce,
    minPerpAuctionDuration: decoded.min_perp_auction_duration,
    defaultMarketOrderTimeInForce: decoded.default_market_order_time_in_force,
    defaultSpotAuctionDuration: decoded.default_spot_auction_duration,
    exchangeStatus: decoded.exchange_status,
    liquidationDuration: decoded.liquidation_duration,
    initialPctToLiquidate: decoded.initial_pct_to_liquidate,
    maxNumberOfSubAccounts: decoded.max_number_of_sub_accounts,
    maxInitializeUserFee: decoded.max_initialize_user_fee,
    padding: decoded.padding,
  } as DriftState;
}

export function decodeDriftUserData(data: Buffer): DriftUser {
  if (!data.slice(0, 8).equals(userDiscriminator)) {
    throw new Error("invalid account discriminator");
  }

  const decoded = DRIFT_ACCOUNTS_CODER.decode("User", data) as any;

  // Transform snake_case field names from IDL to camelCase for TypeScript types
  return {
    authority: decoded.authority,
    spotPositions: decoded.spot_positions.map((p: any) => ({
      scaledBalance: new BN(p.scaled_balance),
      openBids: new BN(p.open_bids),
      openAsks: new BN(p.open_asks),
      cumulativeDeposits: new BN(p.cumulative_deposits),
      marketIndex: p.market_index,
      balanceType: p.balance_type,
      openOrders: p.open_orders,
      padding: p.padding,
    })),
    // delegate: decoded.delegate,
    // name: decoded.name,
    // perpPositions: decoded.perp_positions,
    // orders: decoded.orders,
    // lastAddPerpLpSharesTs: decoded.last_add_perp_lp_shares_ts,
    // totalDeposits: decoded.total_deposits,
    // totalWithdraws: decoded.total_withdraws,
    // totalSocialLoss: decoded.total_social_loss,
    // settledPerpPnl: decoded.settled_perp_pnl,
    // cumulativeSpotFees: decoded.cumulative_spot_fees,
    // cumulativePerpFunding: decoded.cumulative_perp_funding,
    // liquidationMarginFreed: decoded.liquidation_margin_freed,
    // lastActiveSlot: decoded.last_active_slot,
    // nextOrderId: decoded.next_order_id,
    // maxMarginRatio: decoded.max_margin_ratio,
    // nextLiquidationId: decoded.next_liquidation_id,
    // subAccountId: decoded.sub_account_id,
    // status: decoded.status,
    // isMarginTradingEnabled: decoded.is_margin_trading_enabled,
    // idle: decoded.idle,
    // openOrders: decoded.open_orders,
    // hasOpenOrder: decoded.has_open_order,d
    // openAuctions: decoded.open_auctions,
    // hasOpenAuction: decoded.has_open_auction,
    // marginMode: decoded.margin_mode,
    // poolId: decoded.pool_id,
    // padding1: decoded.padding1,
    // lastFuelBonusUpdateTs: decoded.last_fuel_bonus_update_ts,
    // padding: decoded.padding,
  } as DriftUser;
}

export function decodeDriftUserStatsData(data: Buffer): DriftUserStats {
  if (!data.slice(0, 8).equals(userStatsDiscriminator)) {
    throw new Error("invalid account discriminator");
  }

  const decoded = DRIFT_ACCOUNTS_CODER.decode("UserStats", data) as any;

  // Transform snake_case field names from IDL to camelCase for TypeScript types
  return {
    authority: decoded.authority,
    referrer: decoded.referrer,
    fees: decoded.fees,
    nextEpochTs: decoded.next_epoch_ts,
    makerVolume30d: decoded.maker_volume_30d,
    takerVolume30d: decoded.taker_volume_30d,
    fillerVolume30d: decoded.filler_volume_30d,
    lastMakerVolume30dTs: decoded.last_maker_volume_30d_ts,
    lastTakerVolume30dTs: decoded.last_taker_volume_30d_ts,
    lastFillerVolume30dTs: decoded.last_filler_volume_30d_ts,
    ifStakedQuoteAssetAmount: decoded.if_staked_quote_asset_amount,
    numberOfSubAccounts: decoded.number_of_sub_accounts,
    numberOfSubAccountsCreated: decoded.number_of_sub_accounts_created,
    referrerStatus: decoded.referrer_status,
    disableUpdatePerpBidAskTwap: decoded.disable_update_perp_bid_ask_twap,
    padding1: decoded.padding1,
    fuelOverflowStatus: decoded.fuel_overflow_status,
    fuelInsurance: decoded.fuel_insurance,
    fuelDeposits: decoded.fuel_deposits,
    fuelBorrows: decoded.fuel_borrows,
    fuelPositions: decoded.fuel_positions,
    fuelTaker: decoded.fuel_taker,
    fuelMaker: decoded.fuel_maker,
    ifStakedGovTokenAmount: decoded.if_staked_gov_token_amount,
    lastFuelIfBonusUpdateTs: decoded.last_fuel_if_bonus_update_ts,
    padding: decoded.padding,
  } as DriftUserStats;
}
