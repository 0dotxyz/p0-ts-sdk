import BigNumber from "bignumber.js";
import { PublicKey } from "@solana/web3.js";

import { BankType } from "~/services/bank";
import { OraclePrice } from "~/services/price";
import { shortenAddress } from "~/utils";

import {
  MarginfiAccountType,
  BalanceType,
  MarginRequirementType,
  HealthCacheType,
  HealthCacheStatus,
} from "../../types";
import {
  getBalanceUsdValueWithPriceBias,
  computeBalanceUsdValue,
} from "./balance-value-compute.utils";

/**
 * Health & Free Collateral Calculations
 * =====================================
 */

/**
 * Computes free collateral from an account's cached health data using Initial margin requirements.
 *
 * This is a fast lookup function that reads from the account's existing health cache
 * rather than recalculating from balances. Free collateral represents the amount of value
 * available for new borrows or withdrawals.
 *
 * By default, negative values are clamped to zero (representing no available collateral).
 * Set `clamped: false` to get the raw signed value, which can be negative when under-collateralized.
 *
 * ⚠️ **Warning**: Returns cached values that may be stale if account state has changed
 * since the last health cache computation.
 *
 * @param marginfiAccount - The marginfi account with a populated health cache
 * @param opts - Optional configuration object
 * @param opts.clamped - Whether to clamp negative values to zero (default: true)
 * @returns Free collateral value in USD from cached data (clamped to zero by default)
 *
 * @example
 * ```typescript
 * // Get available collateral from cache (default clamped)
 * const freeCollateral = computeFreeCollateralFromCache(account);
 *
 * // Get raw signed value from cache (can be negative)
 * const signedValue = computeFreeCollateralFromCache(account, { clamped: false });
 * ```
 */
export function computeFreeCollateralFromCache(
  marginfiAccount: MarginfiAccountType,
  opts?: { clamped?: boolean }
): BigNumber {
  const _clamped = opts?.clamped ?? true;

  const { assets, liabilities } = computeHealthComponentsFromCache(
    marginfiAccount,
    MarginRequirementType.Initial
  );

  const signedFreeCollateral = assets.minus(liabilities);

  return _clamped ? BigNumber.max(0, signedFreeCollateral) : signedFreeCollateral;
}

/**
 * Configuration for computing free collateral from balances
 */
export interface ComputeFreeCollateralFromBalancesParams {
  /** Active account balances to compute free collateral for */
  activeBalances: BalanceType[];
  /** Map of bank addresses to bank data */
  banksMap: Map<string, BankType>;
  /** Map of bank addresses to oracle price data */
  oraclePricesByBank: Map<string, OraclePrice>;
  /** Asset share value multipliers by bank address (for integrated protocols like Kamino/Drift) */
  assetShareValueMultiplierByBank?: Map<string, BigNumber>;
  /** Optional emode weight overrides by bank address */
  activeEmodeWeightsByBank?: Map<
    string,
    { assetWeightInit: BigNumber; assetWeightMaint: BigNumber }
  >;
  /** Whether to clamp negative values to zero (default: true) */
  clamped?: boolean;
}

/**
 * Computes free collateral from account balances using Initial margin requirements.
 *
 * Free collateral represents the amount of value available for new borrows or withdrawals.
 * It is calculated as: (weighted assets - weighted liabilities) at Initial margin level.
 *
 * By default, negative values are clamped to zero (representing no available collateral).
 * Set `clamped: false` to get the raw signed value, which can be negative when under-collateralized.
 *
 * @param params - Configuration object for free collateral computation
 * @returns Free collateral value in USD (clamped to zero by default)
 *
 * @example
 * ```typescript
 * // Calculate available collateral for new positions
 * const freeCollateral = computeFreeCollateralFromBalances({
 *   activeBalances: account.balances.filter(b => b.active),
 *   banksMap: client.bankMap,
 *   oraclePricesByBank: client.oraclePriceByBank,
 *   assetShareValueMultiplierByBank: client.assetShareMultiplierByBank,
 * });
 *
 * // Get raw signed value (can be negative)
 * const signedValue = computeFreeCollateralFromBalances({
 *   activeBalances: account.balances.filter(b => b.active),
 *   banksMap: client.bankMap,
 *   oraclePricesByBank: client.oraclePriceByBank,
 *   assetShareValueMultiplierByBank: client.assetShareMultiplierByBank,
 *   clamped: false,
 * });
 * ```
 */
export function computeFreeCollateralFromBalances(
  params: ComputeFreeCollateralFromBalancesParams
): BigNumber {
  const {
    activeBalances,
    banksMap,
    oraclePricesByBank,
    assetShareValueMultiplierByBank,
    activeEmodeWeightsByBank,
    clamped = true,
  } = params;

  const { assets, liabilities } = computeHealthComponentsFromBalances({
    activeBalances,
    banksMap,
    oraclePricesByBank,
    assetShareValueMultiplierByBank,
    activeEmodeWeightsByBank,
    marginRequirement: MarginRequirementType.Initial,
  });

  const signedFreeCollateral = assets.minus(liabilities);

  return clamped ? BigNumber.max(0, signedFreeCollateral) : signedFreeCollateral;
}

/**
 * Retrieves pre-computed health components from an account's cached health data.
 *
 * This is a fast lookup function that reads from the account's existing health cache
 * rather than recalculating from balances. Use this when the health cache is already
 * up-to-date.
 *
 * ⚠️ **Warning**: Returns cached values that may be stale if account state has changed
 * since the last health cache computation.
 *
 * @param marginfiAccount - The marginfi account with a populated health cache
 * @param marginRequirement - Which margin requirement level to retrieve (Equity, Initial, or Maintenance)
 * @returns Object containing cached asset and liability values in USD
 *
 * @example
 * ```typescript
 * // Get initial margin requirements from cache
 * const { assets, liabilities } = computeHealthComponentsFromCache(
 *   account,
 *   MarginRequirementType.Initial
 * );
 * const freeCollateral = assets.minus(liabilities);
 * ```
 */
export function computeHealthComponentsFromCache(
  marginfiAccount: MarginfiAccountType,
  marginRequirement: MarginRequirementType
): {
  assets: BigNumber;
  liabilities: BigNumber;
} {
  if (marginfiAccount.healthCache.simulationStatus === HealthCacheStatus.UNSET) {
    console.warn(
      `Health cache not computed for account ${shortenAddress(marginfiAccount.address)} yet.`
    );
  }

  switch (marginRequirement) {
    case MarginRequirementType.Equity:
      return {
        assets: marginfiAccount.healthCache.assetValueEquity,
        liabilities: marginfiAccount.healthCache.liabilityValueEquity,
      };
    case MarginRequirementType.Initial:
      return {
        assets: marginfiAccount.healthCache.assetValue,
        liabilities: marginfiAccount.healthCache.liabilityValue,
      };
    case MarginRequirementType.Maintenance:
      return {
        assets: marginfiAccount.healthCache.assetValueMaint,
        liabilities: marginfiAccount.healthCache.liabilityValueMaint,
      };
  }
}

/**
 * Configuration for computing health components from balances
 */
export interface ComputeHealthComponentsFromBalancesParams {
  /** Active account balances to compute health for */
  activeBalances: BalanceType[];
  /** Margin requirement type (Equity, Initial, or Maintenance) */
  marginRequirement: MarginRequirementType;
  /** Map of bank addresses to bank data */
  banksMap: Map<string, BankType>;
  /** Map of bank addresses to oracle price data */
  oraclePricesByBank: Map<string, OraclePrice>;
  /** Asset share value multipliers by bank address (for integrated protocols like Kamino/Drift) */
  assetShareValueMultiplierByBank?: Map<string, BigNumber>;
  /** Optional emode weight overrides by bank address */
  activeEmodeWeightsByBank?: Map<
    string,
    {
      assetWeightMaint: BigNumber;
      assetWeightInit: BigNumber;
    }
  >;
  /** Optional banks to exclude from health calculation */
  excludedBanks?: PublicKey[];
}

/**
 * Computes health components (assets and liabilities) from active balances with price bias applied.
 *
 * This function:
 * - Applies price bias (lowest for assets, highest for liabilities) for conservative health estimates
 * - Supports asset share multipliers for integrated protocols (Kamino, Drift)
 * - Allows emode weight overrides for specific banks
 * - Can exclude specific banks from the calculation
 *
 * @param params - Configuration object for health computation
 * @returns Object containing weighted asset and liability values in USD
 *
 * @example
 * ```typescript
 * const { assets, liabilities } = computeHealthComponentsFromBalances({
 *   activeBalances: account.balances.filter(b => b.active),
 *   marginRequirement: MarginRequirementType.Initial,
 *   banksMap: client.bankMap,
 *   oraclePricesByBank: client.oraclePriceByBank,
 *   assetShareValueMultiplierByBank: client.assetShareMultiplierByBank,
 * });
 * ```
 */
export function computeHealthComponentsFromBalances(
  params: ComputeHealthComponentsFromBalancesParams
): {
  assets: BigNumber;
  liabilities: BigNumber;
} {
  const {
    activeBalances,
    banksMap,
    oraclePricesByBank,
    marginRequirement,
    assetShareValueMultiplierByBank,
    activeEmodeWeightsByBank,
    excludedBanks,
  } = params;
  const filteredBalances = activeBalances.filter(
    (accountBalance) => !(excludedBanks ?? []).find((b) => b.equals(accountBalance.bankPk))
  );

  let totalAssets = new BigNumber(0);
  let totalLiabilities = new BigNumber(0);

  for (const accountBalance of filteredBalances) {
    // Cache toBase58 conversion - used 3 times
    const bankKey = accountBalance.bankPk.toBase58();

    const bank = banksMap.get(bankKey);
    if (!bank) {
      console.warn(
        `Bank ${shortenAddress(accountBalance.bankPk)} not found, excluding from health computation`
      );
      continue;
    }

    const oraclePrice = oraclePricesByBank.get(bankKey);
    if (!oraclePrice) {
      console.warn(
        `Price info for bank ${shortenAddress(accountBalance.bankPk)} not found, excluding from health computation`
      );
      continue;
    }

    const emodeWeight = activeEmodeWeightsByBank?.get(bankKey);
    const assetShareValueMultiplier = assetShareValueMultiplierByBank?.get(bankKey);

    // if emode weight is lower than bank config, use bank config
    const activeEmodeWeights = emodeWeight
      ? {
          assetWeightInit: BigNumber.max(
            bank.config.assetWeightInit,
            emodeWeight.assetWeightInit ?? bank.config.assetWeightInit
          ),
          assetWeightMaint: BigNumber.max(
            bank.config.assetWeightMaint,
            emodeWeight.assetWeightMaint ?? bank.config.assetWeightMaint
          ),
        }
      : undefined;

    const { assets, liabilities } = getBalanceUsdValueWithPriceBias({
      balance: accountBalance,
      bank,
      oraclePrice,
      marginRequirement,
      assetShareValueMultiplier,
      activeEmodeWeights,
    });

    totalAssets = totalAssets.plus(assets);
    totalLiabilities = totalLiabilities.plus(liabilities);
  }

  return { assets: totalAssets, liabilities: totalLiabilities };
}

/**
 * Configuration for computing health components without price bias
 */
export interface ComputeHealthComponentsWithoutBiasParams {
  /** Active account balances to compute health for */
  activeBalances: BalanceType[];
  /** Margin requirement type (Equity, Initial, or Maintenance) */
  marginRequirement: MarginRequirementType;
  /** Map of bank addresses to bank data */
  banksMap: Map<string, BankType>;
  /** Map of bank addresses to oracle price data */
  oraclePricesByBank: Map<string, OraclePrice>;
  /** Asset share value multipliers by bank address (for integrated protocols like Kamino/Drift) */
  assetShareValueMultiplierByBank?: Map<string, BigNumber>;
  /** Optional emode weight overrides by bank address */
  activeEmodeWeightsByBank?: Map<
    string,
    {
      assetWeightMaint: BigNumber;
      assetWeightInit: BigNumber;
    }
  >;
  /** Optional banks to exclude from health calculation */
  excludedBanks?: PublicKey[];
}

/**
 * Computes health components (assets and liabilities) from active balances WITHOUT price bias.
 *
 * Key differences from `computeHealthComponentsFromBalances`:
 * - Uses neutral oracle prices (no conservative bias applied)
 * - Primarily used for equity calculations where unbiased values are needed
 *
 * @param params - Configuration object for health computation
 * @returns Object containing weighted asset and liability values in USD (unbiased)
 *
 * @example
 * ```typescript
 * const { assets, liabilities } = computeHealthComponentsWithoutBiasFromBalances({
 *   activeBalances: account.balances.filter(b => b.active),
 *   marginRequirement: MarginRequirementType.Equity,
 *   banksMap: client.bankMap,
 *   oraclePricesByBank: client.oraclePriceByBank,
 *   assetShareValueMultiplierByBank: client.assetShareMultiplierByBank,
 * });
 * ```
 */
export function computeHealthComponentsWithoutBiasFromBalances(
  params: ComputeHealthComponentsWithoutBiasParams
): {
  assets: BigNumber;
  liabilities: BigNumber;
} {
  const {
    activeBalances,
    banksMap,
    oraclePricesByBank,
    marginRequirement,
    assetShareValueMultiplierByBank,
    activeEmodeWeightsByBank,
    excludedBanks,
  } = params;

  const filteredBalances = activeBalances.filter(
    (accountBalance) => !(excludedBanks ?? []).find((b) => b.equals(accountBalance.bankPk))
  );

  let totalAssets = new BigNumber(0);
  let totalLiabilities = new BigNumber(0);

  for (const accountBalance of filteredBalances) {
    // Cache toBase58 conversion - used 3 times
    const bankKey = accountBalance.bankPk.toBase58();

    const bank = banksMap.get(bankKey);
    if (!bank) {
      console.warn(
        `Bank ${shortenAddress(accountBalance.bankPk)} not found, excluding from health computation`
      );
      continue;
    }

    const oraclePrice = oraclePricesByBank.get(bankKey);
    if (!oraclePrice) {
      console.warn(
        `Price info for bank ${shortenAddress(accountBalance.bankPk)} not found, excluding from health computation`
      );
      continue;
    }

    const emodeWeight = activeEmodeWeightsByBank?.get(bankKey);
    const assetShareValueMultiplier = assetShareValueMultiplierByBank?.get(bankKey);

    // if emode weight is lower than bank config, use bank config
    const activeEmodeWeights = emodeWeight
      ? {
          assetWeightInit: BigNumber.max(
            bank.config.assetWeightInit,
            emodeWeight.assetWeightInit ?? bank.config.assetWeightInit
          ),
          assetWeightMaint: BigNumber.max(
            bank.config.assetWeightMaint,
            emodeWeight.assetWeightMaint ?? bank.config.assetWeightMaint
          ),
        }
      : undefined;

    const { assets, liabilities } = computeBalanceUsdValue({
      balance: accountBalance,
      bank,
      oraclePrice,
      marginRequirement,
      activeEmodeWeights,
      assetShareValueMultiplier,
    });

    totalAssets = totalAssets.plus(assets);
    totalLiabilities = totalLiabilities.plus(liabilities);
  }

  return { assets: totalAssets, liabilities: totalLiabilities };
}

/**
 * Configuration for computing health cache status
 */
export interface ComputeHealthCacheStatusParams {
  /** Active account balances to compute health cache for */
  activeBalances: BalanceType[];
  /** Map of bank addresses to bank data */
  banksMap: Map<string, BankType>;
  /** Map of bank addresses to oracle price data */
  oraclePricesByBank: Map<string, OraclePrice>;
  /** Asset share value multipliers by bank address (for integrated protocols like Kamino/Drift) */
  assetShareValueMultiplierByBank?: Map<string, BigNumber>;
  /** Optional emode weight overrides by bank address */
  activeEmodeWeightsByBank?: Map<
    string,
    {
      assetWeightInit: BigNumber;
      assetWeightMaint: BigNumber;
    }
  >;
}

/**
 * Computes a complete health cache with all margin requirement levels.
 *
 * This function calculates health components for all three margin requirement types:
 * - **Equity**: Unbiased prices, used for account value calculations
 * - **Maintenance**: Conservative prices, determines liquidation threshold
 * - **Initial**: Conservative prices, determines whether new positions can be opened
 *
 * The resulting health cache is typically used for:
 * - Real-time health monitoring
 * - Simulating transaction outcomes
 * - Determining account solvency status
 *
 * @param params - Configuration object for health cache computation
 * @returns Complete health cache with all margin requirement levels
 *
 * @example
 * ```typescript
 * const healthCache = computeHealthCacheStatus({
 *   activeBalances: account.balances.filter(b => b.active),
 *   banksMap: client.bankMap,
 *   oraclePricesByBank: client.oraclePriceByBank,
 *   assetShareValueMultiplierByBank: client.assetShareMultiplierByBank,
 *   activeEmodeWeightsByBank: account.emodeWeights,
 * });
 * ```
 */
export function computeHealthCacheStatus(params: ComputeHealthCacheStatusParams): HealthCacheType {
  const {
    activeBalances,
    banksMap,
    oraclePricesByBank,
    assetShareValueMultiplierByBank,
    activeEmodeWeightsByBank,
  } = params;
  const { assets: assetValueEquity, liabilities: liabilityValueEquity } =
    computeHealthComponentsWithoutBiasFromBalances({
      activeBalances,
      marginRequirement: MarginRequirementType.Equity,
      banksMap,
      oraclePricesByBank,
      assetShareValueMultiplierByBank,
      activeEmodeWeightsByBank,
    });

  const { assets: assetValueMaint, liabilities: liabilityValueMaint } =
    computeHealthComponentsFromBalances({
      activeBalances,
      marginRequirement: MarginRequirementType.Maintenance,
      banksMap,
      oraclePricesByBank,
      assetShareValueMultiplierByBank,
      activeEmodeWeightsByBank,
    });

  const { assets: assetValueInitial, liabilities: liabilityValueInitial } =
    computeHealthComponentsFromBalances({
      activeBalances,
      marginRequirement: MarginRequirementType.Initial,
      banksMap,
      oraclePricesByBank,
      assetShareValueMultiplierByBank,
      activeEmodeWeightsByBank,
    });

  const healthCache: HealthCacheType = {
    assetValue: assetValueInitial,
    liabilityValue: liabilityValueInitial,
    assetValueMaint: assetValueMaint,
    liabilityValueMaint: liabilityValueMaint,
    assetValueEquity: assetValueEquity,
    liabilityValueEquity: liabilityValueEquity,
    timestamp: new BigNumber(0),
    flags: [],
    prices: [],
    simulationStatus: HealthCacheStatus.COMPUTED,
  };

  return healthCache;
}

/**
 * Configuration for computing liability health component
 */
export interface ComputeLiabilityHealthComponentParams {
  /** All account balances (will be filtered to liability positions) */
  balances: BalanceType[];
  /** Map of bank addresses to bank data */
  banksMap: Map<string, BankType>;
  /** Map of bank addresses to oracle price data */
  oraclePricesByBank: Map<string, OraclePrice>;
  /** Specific bank addresses to include as liabilities */
  liabilityBanks: PublicKey[];
  /** Margin requirement type (Equity, Initial, or Maintenance) */
  marginRequirement: MarginRequirementType;
}

/**
 * Computes the total weighted liability value for specific liability positions.
 *
 * This function filters balances to only include positions in the specified liability banks,
 * then calculates their total weighted USD value using conservative pricing (highest price bias).
 *
 * Useful for:
 * - Calculating partial health impacts when simulating repayments
 * - Analyzing liability exposure to specific assets
 * - Risk assessment for particular debt positions
 *
 * @param params - Configuration object for liability health computation
 * @returns Total weighted liability value in USD for the specified banks
 *
 * @example
 * ```typescript
 * // Calculate liability value for USDC and SOL positions
 * const liabilityValue = computeLiabilityHealthComponent({
 *   balances: account.balances,
 *   banksMap: client.bankMap,
 *   oraclePricesByBank: client.oraclePriceByBank,
 *   liabilityBanks: [usdcBankAddress, solBankAddress],
 *   marginRequirement: MarginRequirementType.Initial,
 * });
 * ```
 */
export function computeLiabilityHealthComponent(
  params: ComputeLiabilityHealthComponentParams
): BigNumber {
  const { balances, banksMap, oraclePricesByBank, liabilityBanks, marginRequirement } = params;

  const liabilitySet = new Set(liabilityBanks.map((b) => b.toBase58()));

  // Filter to only include liability balances
  const activeLiabilityBalances = balances.filter(
    (b) => b.active && liabilitySet.has(b.bankPk.toBase58())
  );

  const { liabilities } = computeHealthComponentsFromBalances({
    activeBalances: activeLiabilityBalances,
    marginRequirement,
    banksMap,
    oraclePricesByBank,
  });

  return liabilities;
}

/**
 * Configuration for computing asset health component
 */
export interface ComputeAssetHealthComponentParams {
  /** All account balances (will be filtered to asset positions) */
  balances: BalanceType[];
  /** Map of bank addresses to bank data */
  banksMap: Map<string, BankType>;
  /** Map of bank addresses to oracle price data */
  oraclePricesByBank: Map<string, OraclePrice>;
  /** Specific bank addresses to include as assets */
  assetBanks: PublicKey[];
  /** Margin requirement type (Equity, Initial, or Maintenance) */
  marginRequirement: MarginRequirementType;
  /** Asset share value multipliers by bank address (for integrated protocols like Kamino/Drift) */
  assetShareValueMultiplierByBank?: Map<string, BigNumber>;
  /** Optional emode weight overrides by bank address */
  activeEmodeWeightsByBank?: Map<
    string,
    { assetWeightInit: BigNumber; assetWeightMaint: BigNumber }
  >;
}

/**
 * Computes the total weighted asset value for specific asset positions.
 *
 * This function filters balances to only include positions in the specified asset banks,
 * then calculates their total weighted USD value using conservative pricing (lowest price bias).
 *
 * Useful for:
 * - Calculating partial health impacts when simulating withdrawals
 * - Analyzing collateral value from specific assets
 * - Risk assessment for particular lending positions
 * - Determining borrowing power from subset of collateral
 *
 * @param params - Configuration object for asset health computation
 * @returns Total weighted asset value in USD for the specified banks
 *
 * @example
 * ```typescript
 * // Calculate asset value for SOL and USDC collateral positions
 * const assetValue = computeAssetHealthComponent({
 *   balances: account.balances,
 *   banksMap: client.bankMap,
 *   oraclePricesByBank: client.oraclePriceByBank,
 *   assetBanks: [solBankAddress, usdcBankAddress],
 *   marginRequirement: MarginRequirementType.Initial,
 *   assetShareValueMultiplierByBank: client.assetShareMultiplierByBank,
 * });
 * ```
 */
export function computeAssetHealthComponent(params: ComputeAssetHealthComponentParams): BigNumber {
  const {
    balances,
    banksMap,
    oraclePricesByBank,
    assetBanks,
    marginRequirement,
    assetShareValueMultiplierByBank,
    activeEmodeWeightsByBank,
  } = params;

  const assetSet = new Set(assetBanks.map((b) => b.toBase58()));

  // Filter to only include asset balances
  const activeAssetBalances = balances.filter((b) => b.active && assetSet.has(b.bankPk.toBase58()));

  const { assets } = computeHealthComponentsFromBalances({
    activeBalances: activeAssetBalances,
    marginRequirement,
    banksMap,
    oraclePricesByBank,
    assetShareValueMultiplierByBank,
    activeEmodeWeightsByBank,
  });

  return assets;
}
