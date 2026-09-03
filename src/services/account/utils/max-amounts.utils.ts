import { PublicKey } from "@solana/web3.js";
import BigNumber from "bignumber.js";

import { MarginfiAccountType, MarginRequirementType } from "../types";

import {
  computeFreeCollateralFromCache,
  computeFreeCollateralFromBalances,
  computeHealthComponentsFromCache,
  computeQuantityUi,
  getActiveBalances,
  getBalance,
} from "./compute";

import {
  ActiveEmodePair,
  AssetTag,
  BankRateLimiterType,
  BankType,
  computeAssetUsdValue,
  computeBankBorrowCapRemaining,
  computeBankProjectedAvailableLiquidity,
  computeBankDepositCapRemaining,
  computeBankRateLimitRemaining,
  computeGroupRateLimitRemainingUsd,
  computeVenueAvailableLiquidity,
  BankVenueStates,
  EmodeImpactStatus,
  getAssetWeight,
  getLiabilityWeight,
  RiskTier,
} from "~/services/bank";
import { getPrice, OraclePrice, PriceBias } from "~/services/price";

/**
 * Configuration for computing maximum borrow amount for a bank
 */
export interface ComputeMaxBorrowForBankParams {
  /** The marginfi account to compute max borrow for */
  account: MarginfiAccountType;
  /** Map of banks by their address */
  banksMap: Map<string, BankType>;
  /** Map of oracle prices by bank address */
  oraclePricesByBank: Map<string, OraclePrice>;
  /** The bank address to compute max borrow for */
  bankAddress: PublicKey;
  /** Asset share value multipliers by bank address (for integrated protocols like Kamino/Drift) */
  assetShareValueMultiplierByBank?: Map<string, BigNumber>;
  /** E-mode impact status (determines whether to use cache or compute from balances) */
  emodeImpactStatus?: EmodeImpactStatus;
  /** Volatility factor to apply to free collateral (default: 1) */
  volatilityFactor?: number;
  /** Active e-mode pair for applying e-mode weights */
  activePair?: ActiveEmodePair;
  /**
   * Group-level rate limiter (USD windows). When provided and enabled, the result is also clamped
   * to the group's remaining outflow capacity converted at the unbiased realtime price.
   */
  groupRateLimiter?: BankRateLimiterType;
  /**
   * Skip the bank-level clamps (remaining borrow cap, available liquidity, bank/group rate
   * limiters) and return the purely health-based amount (default: false)
   */
  ignoreBankLimits?: boolean;
}

/**
 * Calculates the maximum amount that can be borrowed from a bank.
 *
 * This function computes the borrowing capacity based on:
 * - **Free collateral**: Available collateral not backing existing liabilities
 * - **Isolated tier constraints**: Isolated assets cannot be borrowed with active debt
 * - **E-mode weights**: Enhanced weights for assets in the same e-mode category
 * - **Oracle prices**: Conservative pricing (lowest for assets, highest for liabilities)
 * - **Bank limits**: Remaining borrow cap (`borrowLimit - totalBorrows`, interest-buffered),
 *   available liquidity (`totalDeposits - totalBorrows`), the bank's net-outflow rate limiter and
 *   (if `groupRateLimiter` is provided) the group's USD rate limiter — unless `ignoreBankLimits`
 *
 * **Isolated Asset Rules:**
 * - Cannot borrow isolated assets if other liabilities exist
 * - Cannot borrow new assets if existing debt is in isolated tier
 *
 * **Calculation Formula:**
 * ```
 * If assetWeight > 0:
 *   maxBorrow = (min(fc, ucb) / (price_lowest * asset_weight)) +
 *               ((fc - min(fc, ucb)) / (price_highest * liab_weight))
 * Else:
 *   maxBorrow = existingAssets + ((fc - ucb) / (price_highest * liab_weight))
 *
 * maxBorrow = min(maxBorrow, remainingBorrowCap, availableLiquidity, rateLimitRemaining)
 * ```
 * All liability-denominated terms are divided by `(1 + protocolOriginationFee)` because the
 * program books the origination fee as additional borrowed liability.
 * Where:
 * - `fc` = free collateral (with volatility factor)
 * - `ucb` = untied collateral for bank (existing deposits)
 *
 * @param params - Configuration object for max borrow computation
 * @returns Maximum amount that can be borrowed (in UI units)
 *
 * @example
 * ```typescript
 * const maxBorrow = computeMaxBorrowForBank({
 *   account,
 *   banks: client.bankMap,
 *   oraclePrices: client.oraclePriceByBank,
 *   bankAddress: usdcBankPk,
 *   volatilityFactor: 0.95, // 5% safety margin
 *   emodeImpactStatus: EmodeImpactStatus.InactiveEmode,
 * });
 * console.log(`Can borrow up to ${maxBorrow.toFixed(2)} USDC`);
 * ```
 */
export function computeMaxBorrowForBank(params: ComputeMaxBorrowForBankParams): BigNumber {
  const {
    account,
    banksMap,
    oraclePricesByBank,
    bankAddress,
    assetShareValueMultiplierByBank,
    emodeImpactStatus,
    volatilityFactor,
    activePair,
    groupRateLimiter,
    ignoreBankLimits,
  } = params;
  const bank = banksMap.get(bankAddress.toBase58());

  if (!bank) throw Error(`Bank ${bankAddress.toBase58()} not found`);

  // Build Map of e-mode collateral banks if activePair exists
  const activeEmodeWeightsByBank =
    activePair?.collateralBanks.reduce((map, bankPk) => {
      const bank = banksMap.get(bankPk.toBase58());
      if (bank) {
        map.set(bankPk.toBase58(), {
          assetWeightMaint: activePair.assetWeightMaint,
          assetWeightInit: activePair.assetWeightInit,
        });
      }
      return map;
    }, new Map<string, { assetWeightMaint: BigNumber; assetWeightInit: BigNumber }>()) ??
    new Map<string, { assetWeightMaint: BigNumber; assetWeightInit: BigNumber }>();

  const activeEmodeWeightsForBank = activeEmodeWeightsByBank.get(bankAddress.toBase58());
  const assetShareValueMultiplier = assetShareValueMultiplierByBank?.get(bankAddress.toBase58());

  const oraclePrice = oraclePricesByBank.get(bankAddress.toBase58());
  if (!oraclePrice) throw Error(`Oracle price for ${bankAddress.toBase58()} not found`);

  const activeBalances = getActiveBalances(account.balances);

  // -------------------------- //
  // isolated asset constraints //
  // -------------------------- //

  const hasLiabilitiesAlready =
    activeBalances.filter((b) => b.liabilityShares.gt(0) && !b.bankPk.equals(bankAddress)).length >
    0;

  const attemptingToBorrowIsolatedAssetWithActiveDebt =
    bank.config.riskTier === RiskTier.Isolated && hasLiabilitiesAlready;

  const existingLiabilityBanks = activeBalances
    .filter((b) => b.liabilityShares.gt(0))
    .map((b) => banksMap.get(b.bankPk.toBase58())!);

  const attemptingToBorrowNewAssetWithExistingIsolatedDebt = existingLiabilityBanks.some(
    (b) => b.config.riskTier === RiskTier.Isolated && !b.address.equals(bankAddress)
  );

  if (
    attemptingToBorrowIsolatedAssetWithActiveDebt ||
    attemptingToBorrowNewAssetWithExistingIsolatedDebt
  ) {
    // Cannot borrow due to isolated tier constraints
    return new BigNumber(0);
  }

  // ------------- //
  // FC-based calc //
  // ------------- //

  const _volatilityFactor = volatilityFactor ?? 1;

  const balance = getBalance(bankAddress, activeBalances);

  const useCache =
    emodeImpactStatus === EmodeImpactStatus.InactiveEmode ||
    emodeImpactStatus === EmodeImpactStatus.ExtendEmode;

  const freeCollateral = useCache
    ? computeFreeCollateralFromCache(account).times(_volatilityFactor)
    : computeFreeCollateralFromBalances({
        activeBalances,
        banksMap,
        oraclePricesByBank,
        activeEmodeWeightsByBank,
        assetShareValueMultiplierByBank,
      }).times(_volatilityFactor);

  const untiedCollateralForBank = BigNumber.min(
    computeAssetUsdValue({
      bank,
      oraclePrice,
      assetShares: balance.assetShares,
      marginRequirement: MarginRequirementType.Initial,
      priceBias: PriceBias.Lowest,
      activeEmodeWeights: activeEmodeWeightsForBank,
      assetShareValueMultiplier,
    }),
    freeCollateral
  );

  const priceLowestBias = getPrice(oraclePrice, PriceBias.Lowest, true);
  const priceHighestBias = getPrice(oraclePrice, PriceBias.Highest, true);
  const assetWeight = getAssetWeight({
    bank,
    marginRequirement: MarginRequirementType.Initial,
    oraclePrice,
    activeEmodeWeights: activeEmodeWeightsForBank,
    assetShareValueMultiplier,
  });
  const liabWeight = getLiabilityWeight(bank.config, MarginRequirementType.Initial);

  // The program books `amount * (1 + protocol_origination_fee)` as the new liability (the fee is
  // borrowed on the user's behalf), so every liability-denominated bound is divided by it.
  const originationFeeFactor = new BigNumber(1).plus(
    bank.config.interestRateConfig.protocolOriginationFee
  );
  const liabPriceWeighted = priceHighestBias.times(liabWeight).times(originationFeeFactor);

  const healthMaxBorrow = assetWeight.eq(0)
    ? computeQuantityUi(balance, bank, assetShareValueMultiplier).assets.plus(
        freeCollateral.minus(untiedCollateralForBank).div(liabPriceWeighted)
      )
    : untiedCollateralForBank
        .div(priceLowestBias.times(assetWeight))
        .plus(freeCollateral.minus(untiedCollateralForBank).div(liabPriceWeighted));

  if (ignoreBankLimits) return healthMaxBorrow;

  // ----------------- //
  // bank-level clamps //
  // ----------------- //

  // borrow cap: total_liabilities + amount * (1 + fee) < borrow_limit
  const borrowCapRemaining = new BigNumber(computeBankBorrowCapRemaining(bank)).div(
    originationFeeFactor
  );
  // utilization: total_assets >= total_liabilities + amount * (1 + fee) (after interest accrual)
  const availableLiquidity = computeBankProjectedAvailableLiquidity(
    bank,
    assetShareValueMultiplier
  ).div(originationFeeFactor);
  // rate limiters record the pre-fee `amount` only
  const rateLimitRemaining = computeOutflowRateLimitRemaining(
    bank,
    oraclePrice,
    groupRateLimiter,
    assetShareValueMultiplier
  );

  return BigNumber.max(
    0,
    BigNumber.min(healthMaxBorrow, borrowCapRemaining, availableLiquidity, rateLimitRemaining)
  );
}

/**
 * Remaining outflow (withdraw/borrow) allowed by the bank-level rate limiter (native tokens) and,
 * if provided, the group-level rate limiter (USD, converted at the unbiased realtime price —
 * mirroring the program's `record_withdrawal_outflow`). Returns +Infinity when no limiter is
 * enabled so it is a no-op inside `BigNumber.min`.
 *
 * The result is in underlying UI units to match the other max-amount clamps. The bank-level
 * limiter records the withdraw instruction's own denomination, which differs per venue:
 * - DEFAULT / DRIFT / JUPLEND: underlying token amount (Drift records `token_amount`, JupLend
 *   `native_outflow`, not their internal scaled/share balances) — already underlying, no
 *   conversion.
 * - KAMINO: cToken collateral amount (the instruction's `amount` is denominated in collateral
 *   tokens) — multiplied by the cToken exchange rate.
 * - STAKED: LST amount (the bank mint) — multiplied by the LST→SOL rate to reach the SDK's
 *   SOL-equivalent underlying space.
 */
function computeOutflowRateLimitRemaining(
  bank: BankType,
  oraclePrice: OraclePrice,
  groupRateLimiter?: BankRateLimiterType,
  assetShareValueMultiplier?: BigNumber
): BigNumber {
  const nowSeconds = Date.now() / 1000;
  let remaining = new BigNumber(Infinity);

  let bankRemaining = computeBankRateLimitRemaining(bank, nowSeconds);
  if (bankRemaining !== null) {
    const limiterInBankMintUnits =
      bank.config.assetTag === AssetTag.KAMINO || bank.config.assetTag === AssetTag.STAKED;
    if (limiterInBankMintUnits && assetShareValueMultiplier?.gt(0)) {
      bankRemaining = bankRemaining.times(assetShareValueMultiplier);
    }
    remaining = BigNumber.min(remaining, bankRemaining);
  }

  // Program: `calc_value(amount, unbiased realtime price).to_num::<i64>() > remaining` fails.
  const groupRemainingUsd = computeGroupRateLimitRemainingUsd(groupRateLimiter, nowSeconds);
  if (groupRemainingUsd !== null) {
    const price = getPrice(oraclePrice, PriceBias.None, false);
    if (price.gt(0)) remaining = BigNumber.min(remaining, groupRemainingUsd.div(price));
  }

  return remaining;
}

/**
 * Configuration for computing maximum withdraw amount for a bank
 */
export interface ComputeMaxWithdrawForBankParams {
  /** The marginfi account to compute max withdraw for */
  account: MarginfiAccountType;
  /** Map of banks by their address */
  banksMap: Map<string, BankType>;
  /** Map of oracle prices by bank address */
  oraclePricesByBank: Map<string, OraclePrice>;
  /** Asset share value multipliers by bank address (for integrated protocols like Kamino/Drift) */
  assetShareValueMultiplierByBank?: Map<string, BigNumber>;
  /** The bank address to compute max withdraw for */
  bankAddress: PublicKey;
  /** Volatility factor to apply to free collateral (default: 1) */
  volatilityFactor?: number;
  /** Active e-mode pair for applying e-mode weights */
  activePair?: ActiveEmodePair;
  /**
   * Group-level rate limiter (USD windows). When provided and enabled, the result is also clamped
   * to the group's remaining outflow capacity converted at the unbiased realtime price.
   */
  groupRateLimiter?: BankRateLimiterType;
  /**
   * Venue-side account states for integrated banks (Kamino/Drift/JupLend), e.g.
   * `client.bankIntegrationMap[bankAddress]`. When provided, the result is also clamped to the
   * venue's own idle liquidity — the marginfi-level totals only describe what marginfi has
   * delegated, so a fully utilized venue reserve correctly reports 0 withdrawable.
   */
  venueStates?: BankVenueStates;
  /**
   * Skip the bank-level clamps (available liquidity, venue liquidity, bank/group rate limiters)
   * and return the purely health-based amount (default: false)
   */
  ignoreBankLimits?: boolean;
}

/**
 * Calculates the maximum amount that can be withdrawn from a bank.
 *
 * This function computes the withdrawal capacity based on:
 * - **Free collateral**: Available collateral after maintaining required margins
 * - **Asset weights**: Risk-adjusted value of deposits (Initial and Maintenance)
 * - **E-mode weights**: Enhanced weights for assets in the same e-mode category
 * - **Oracle prices**: Conservative pricing to ensure safe withdrawals
 * - **Bank limits**: Result is clamped to available liquidity (`totalDeposits - totalBorrows`),
 *   the bank's net-outflow rate limiter, (if `groupRateLimiter` is provided) the group's USD
 *   rate limiter and (if `venueStates` is provided) the integrated venue's idle liquidity —
 *   unless `ignoreBankLimits` is set
 *
 * **Key Differences from Max Borrow:**
 * - Uses both Initial and Maintenance asset weights
 * - No isolated tier constraints (can always withdraw your own assets)
 * - Calculates based on existing deposits, not new positions
 *
 * **Safety Mechanism:**
 * The volatility factor (default: 1.0) can be reduced to add a safety buffer,
 * preventing withdrawals that would leave the account close to liquidation.
 *
 * @param params - Configuration object for max withdraw computation
 * @returns Maximum amount that can be withdrawn (in UI units)
 *
 * @example
 * ```typescript
 * const maxWithdraw = computeMaxWithdrawForBank({
 *   account,
 *   banksMap: client.bankMap,
 *   oraclePricesByBank: client.oraclePriceByBank,
 *   bankAddress: usdcBankPk,
 *   volatilityFactor: 0.98, // 2% safety margin
 *   assetShareValueMultiplierByBank: client.assetShareValueMultiplierByBank,
 * });
 * console.log(`Can withdraw up to ${maxWithdraw.toFixed(2)} USDC`);
 * ```
 */
export function computeMaxWithdrawForBank(params: ComputeMaxWithdrawForBankParams): BigNumber {
  const {
    banksMap,
    bankAddress,
    oraclePricesByBank,
    assetShareValueMultiplierByBank,
    groupRateLimiter,
    venueStates,
    ignoreBankLimits,
  } = params;
  const bank = banksMap.get(bankAddress.toBase58());
  if (!bank) throw Error(`Bank ${bankAddress.toBase58()} not found`);

  const healthMaxWithdraw = computeHealthMaxWithdrawForBank(params);
  if (ignoreBankLimits) return healthMaxWithdraw;

  // ----------------- //
  // bank-level clamps //
  // ----------------- //

  const oraclePrice = oraclePricesByBank.get(bankAddress.toBase58());
  if (!oraclePrice) throw Error(`Oracle price for ${bankAddress.toBase58()} not found`);

  const assetShareValueMultiplier = assetShareValueMultiplierByBank?.get(bankAddress.toBase58());
  // utilization: total_assets - amount >= total_liabilities (after interest accrual)
  const availableLiquidity = computeBankProjectedAvailableLiquidity(
    bank,
    assetShareValueMultiplier
  );
  const rateLimitRemaining = computeOutflowRateLimitRemaining(
    bank,
    oraclePrice,
    groupRateLimiter,
    assetShareValueMultiplier
  );

  const clamps = [healthMaxWithdraw, availableLiquidity, rateLimitRemaining];
  const venueLiquidity = computeVenueAvailableLiquidity(bank, venueStates);
  if (venueLiquidity !== undefined) clamps.push(venueLiquidity);

  return BigNumber.max(0, BigNumber.min(...clamps));
}

/**
 * Health-based max withdraw (no bank-level clamps). See {@link computeMaxWithdrawForBank}.
 */
function computeHealthMaxWithdrawForBank(params: ComputeMaxWithdrawForBankParams): BigNumber {
  const {
    account,
    banksMap,
    oraclePricesByBank,
    assetShareValueMultiplierByBank,
    bankAddress,
    volatilityFactor,
    activePair,
  } = params;
  const opts = { volatilityFactor, activePair };

  const bank = banksMap.get(bankAddress.toBase58());
  if (!bank) throw Error(`Bank ${bankAddress.toBase58()} not found`);

  // Build Map of e-mode collateral banks if activePair exists
  const activeEmodeWeightsByBank =
    activePair?.collateralBanks.reduce((map, bankPk) => {
      const bank = banksMap.get(bankPk.toBase58());
      if (bank) {
        map.set(bankPk.toBase58(), {
          assetWeightMaint: activePair.assetWeightMaint,
          assetWeightInit: activePair.assetWeightInit,
        });
      }
      return map;
    }, new Map<string, { assetWeightMaint: BigNumber; assetWeightInit: BigNumber }>()) ??
    new Map<string, { assetWeightMaint: BigNumber; assetWeightInit: BigNumber }>();

  const activeEmodeWeightsForBank = activeEmodeWeightsByBank.get(bankAddress.toBase58());
  const assetShareValueMultiplier = assetShareValueMultiplierByBank?.get(bankAddress.toBase58());

  const oraclePrice = oraclePricesByBank.get(bankAddress.toBase58());
  if (!oraclePrice) throw Error(`Oracle price for ${bankAddress.toBase58()} not found`);

  const _volatilityFactor = opts?.volatilityFactor ?? 1;

  // Get weights - they'll use emode weights if bank was modified
  const initAssetWeight = getAssetWeight({
    bank,
    marginRequirement: MarginRequirementType.Initial,
    oraclePrice,
    activeEmodeWeights: activeEmodeWeightsForBank,
    assetShareValueMultiplier,
    ignoreSoftLimits: false,
  });
  const maintAssetWeight = getAssetWeight({
    bank,
    marginRequirement: MarginRequirementType.Maintenance,
    oraclePrice,
    activeEmodeWeights: activeEmodeWeightsForBank,
    assetShareValueMultiplier,
    ignoreSoftLimits: false,
  });
  const activeBalances = getActiveBalances(account.balances);
  const balance = getBalance(bankAddress, activeBalances);

  // Recalculate free collateral if emode weights were applied
  const freeCollateral = opts?.activePair
    ? computeFreeCollateralFromBalances({
        activeBalances,
        banksMap,
        oraclePricesByBank,
        activeEmodeWeightsByBank,
        assetShareValueMultiplierByBank,
      })
    : computeFreeCollateralFromCache(account);

  const initCollateralForBank = computeAssetUsdValue({
    bank,
    oraclePrice,
    assetShares: balance.assetShares,
    marginRequirement: MarginRequirementType.Initial,
    priceBias: PriceBias.Lowest,
    activeEmodeWeights: activeEmodeWeightsForBank,
    assetShareValueMultiplier,
  });

  const entireBalance = computeQuantityUi(balance, bank, assetShareValueMultiplier).assets;

  const { liabilities: liabilitiesInit } = computeHealthComponentsFromCache(
    account,
    MarginRequirementType.Initial
  );

  // -------------------------------------------------- //
  // isolated bank (=> init weight = maint weight = 0)  //
  // or collateral bank with 0-weights (does not happen //
  // in practice)                                       //
  // -------------------------------------------------- //

  if (
    bank.config.riskTier === RiskTier.Isolated ||
    (initAssetWeight.isZero() && maintAssetWeight.isZero())
  ) {
    if (freeCollateral.isZero() && !liabilitiesInit.isZero()) {
      // if account is already below init requirements and has active debt, prevent any withdrawal even if those don't count as collateral
      // inefficient, but reflective of contract which does not look at action delta, but only end state atm
      return new BigNumber(0);
    } else {
      return entireBalance;
    }
  }

  // ----------------------------- //
  // collateral bank being retired //
  // ----------------------------- //

  if (initAssetWeight.isZero() && !maintAssetWeight.isZero()) {
    if (liabilitiesInit.eq(0)) {
      return entireBalance;
    } else if (freeCollateral.isZero()) {
      return new BigNumber(0); // inefficient, but reflective of contract which does not look at action delta, but only end state
    } else {
      const { liabilities: maintLiabilities, assets: maintAssets } =
        computeHealthComponentsFromCache(account, MarginRequirementType.Maintenance);
      const maintUntiedCollateral = maintAssets.minus(maintLiabilities);

      const priceLowestBias = getPrice(oraclePrice, PriceBias.Lowest, true);
      const maintWeightedPrice = priceLowestBias.times(maintAssetWeight);

      return maintUntiedCollateral.div(maintWeightedPrice);
    }
  }

  // ------------------------------------- //
  // collateral bank with positive weights //
  // ------------------------------------- //
  // bypass volatility factor if no liabilities or if all collateral is untied
  if (liabilitiesInit.isZero() || initCollateralForBank.lte(freeCollateral)) {
    return entireBalance;
  }

  // apply volatility factor to avoid failure due to price volatility / slippage
  const initUntiedCollateralForBank = freeCollateral.times(_volatilityFactor);

  const priceLowestBias = getPrice(oraclePrice, PriceBias.Lowest, true);
  const initWeightedPrice = priceLowestBias.times(initAssetWeight);
  const maxWithdraw = initUntiedCollateralForBank.div(initWeightedPrice);

  return maxWithdraw;
}

/**
 * Configuration for computing maximum deposit amount for a bank
 */
export interface ComputeMaxDepositForBankParams {
  /** Map of banks by their address */
  banksMap: Map<string, BankType>;
  /** The bank address to compute max deposit for */
  bankAddress: PublicKey;
  /**
   * Asset share value multipliers by bank address (for integrated protocols like Kamino/Drift and
   * staked-collateral banks). The bank's `depositLimit` is denominated in its native share units;
   * the multiplier converts the remaining capacity to underlying UI units.
   */
  assetShareValueMultiplierByBank?: Map<string, BigNumber>;
  /** Wallet token balance in UI units; if provided, the result is capped to it */
  walletBalance?: BigNumber | number;
}

/**
 * Calculates the maximum amount that can be deposited into a bank.
 *
 * Deposits are not constrained by account health, only by the bank's deposit cap
 * (`depositLimit - totalDeposits`, buffered for interest accrued since the last update)
 * and, optionally, the caller's wallet balance.
 *
 * @param params - Configuration object for max deposit computation
 * @returns Maximum amount that can be deposited (in UI units)
 *
 * @example
 * ```typescript
 * const maxDeposit = computeMaxDepositForBank({
 *   banksMap: client.bankMap,
 *   bankAddress: usdcBankPk,
 *   assetShareValueMultiplierByBank: client.assetShareValueMultiplierByBank,
 *   walletBalance: 1_000, // UI units
 * });
 * ```
 */
export function computeMaxDepositForBank(params: ComputeMaxDepositForBankParams): BigNumber {
  const { banksMap, bankAddress, assetShareValueMultiplierByBank, walletBalance } = params;
  const bank = banksMap.get(bankAddress.toBase58());
  if (!bank) throw Error(`Bank ${bankAddress.toBase58()} not found`);

  const assetShareValueMultiplier = assetShareValueMultiplierByBank?.get(bankAddress.toBase58());
  const depositCapRemaining = new BigNumber(computeBankDepositCapRemaining(bank)).times(
    assetShareValueMultiplier ?? 1
  );
  if (walletBalance === undefined) return depositCapRemaining;

  return BigNumber.max(0, BigNumber.min(depositCapRemaining, new BigNumber(walletBalance)));
}
