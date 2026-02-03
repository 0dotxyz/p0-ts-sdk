import BigNumber from "bignumber.js";
import { PublicKey } from "@solana/web3.js";

import {
  ActiveEmodePair,
  BankType,
  computeAssetUsdValue,
  EmodeImpactStatus,
  getAssetWeight,
  getLiabilityWeight,
  RiskTier,
} from "~/services/bank";
import { getPrice, OraclePrice, PriceBias } from "~/services/price";

import { MarginfiAccountType, MarginRequirementType } from "../types";

import {
  computeFreeCollateralFromCache,
  computeFreeCollateralFromBalances,
  computeHealthComponentsFromCache,
  computeQuantityUi,
  getActiveBalances,
  getBalance,
} from "./compute";

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
}

/**
 * Calculates the maximum amount that can be borrowed from a bank.
 *
 * This function computes the borrowing capacity based on:
 * - **Free collateral**: Available collateral not backing existing liabilities
 * - **Isolated tier constraints**: Isolated assets cannot be borrowed with active debt
 * - **E-mode weights**: Enhanced weights for assets in the same e-mode category
 * - **Oracle prices**: Conservative pricing (lowest for assets, highest for liabilities)
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
 * ```
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

  let freeCollateral = useCache
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

  if (assetWeight.eq(0)) {
    return computeQuantityUi(balance, bank).assets.plus(
      freeCollateral.minus(untiedCollateralForBank).div(priceHighestBias.times(liabWeight))
    );
  } else {
    return untiedCollateralForBank
      .div(priceLowestBias.times(assetWeight))
      .plus(freeCollateral.minus(untiedCollateralForBank).div(priceHighestBias.times(liabWeight)));
  }
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
}

/**
 * Calculates the maximum amount that can be withdrawn from a bank.
 *
 * This function computes the withdrawal capacity based on:
 * - **Free collateral**: Available collateral after maintaining required margins
 * - **Asset weights**: Risk-adjusted value of deposits (Initial and Maintenance)
 * - **E-mode weights**: Enhanced weights for assets in the same e-mode category
 * - **Oracle prices**: Conservative pricing to ensure safe withdrawals
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
