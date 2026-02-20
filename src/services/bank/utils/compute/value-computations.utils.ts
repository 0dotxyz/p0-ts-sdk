import BigNumber from "bignumber.js";

import { OraclePrice, PriceBias, getPrice } from "~/services/price";
import { MarginRequirementType } from "~/services/account/types";
import { toBigNumber } from "~/utils";
import { Amount } from "~/types";

import { BankType, BankConfigType } from "../../types";
import { getAssetQuantity, getLiabilityQuantity } from "./share-conversions.utils";

/**
 * Weight, USD Value & Leverage Computation Utilities
 * ==================================================
 */

/**
 * Determines if a margin requirement type uses weighted prices.
 *
 * Initial margin uses weighted prices (EMA-based), while Maintenance and Equity
 * use spot prices for more accurate liquidation decisions.
 *
 * @param marginRequirement - The margin requirement type to check
 * @returns True if Initial margin (uses weighted prices), false otherwise
 */
export function isWeightedPrice(marginRequirement: MarginRequirementType): boolean {
  return marginRequirement === MarginRequirementType.Initial;
}

/**
 * Configuration for computing asset weight
 */
export interface GetAssetWeightParams {
  /** The bank to compute weight for */
  bank: BankType;
  /** Which margin requirement level (Initial, Maintenance, Equity) */
  marginRequirement: MarginRequirementType;
  /** Oracle price data (needed for soft limit calculations) */
  oraclePrice: OraclePrice;
  /** Asset share value multiplier for integrated protocols (Kamino, Drift) */
  assetShareValueMultiplier?: BigNumber;
  /** Optional emode weight overrides */
  activeEmodeWeights?: {
    assetWeightInit: BigNumber;
    assetWeightMaint: BigNumber;
  };
  /** Skip soft limit scaling for Initial margin (default: false) */
  ignoreSoftLimits?: boolean;
}

/**
 * Computes the asset weight for a bank based on margin requirement type.
 *
 * Asset weights determine how much collateral value an asset provides:
 * - **Initial**: Weight for opening new positions (includes soft limit scaling)
 * - **Maintenance**: Weight for liquidation threshold
 * - **Equity**: No weighting (1.0)
 *
 * For Initial margin, if the total bank collateral exceeds `totalAssetValueInitLimit`,
 * the weight is scaled down proportionally to limit systemic risk.
 *
 * @param params - Configuration object for asset weight computation
 * @returns Asset weight as a decimal (e.g., 0.9 means 90% collateral value)
 *
 * @example
 * ```typescript
 * // Get initial margin weight with soft limits
 * const weight = getAssetWeight({
 *   bank,
 *   marginRequirement: MarginRequirementType.Initial,
 *   oraclePrice,
 * });
 *
 * // Get weight ignoring soft limits
 * const rawWeight = getAssetWeight({
 *   bank,
 *   marginRequirement: MarginRequirementType.Initial,
 *   oraclePrice,
 *   ignoreSoftLimits: true,
 * });
 * ```
 */
export function getAssetWeight(params: GetAssetWeightParams): BigNumber {
  const {
    bank,
    marginRequirement,
    oraclePrice,
    assetShareValueMultiplier,
    activeEmodeWeights,
    ignoreSoftLimits,
  } = params;

  // if emode weight is lower then bank weight, bank weight should be used
  const assetWeightInit = BigNumber.max(
    activeEmodeWeights?.assetWeightInit ?? BigNumber(0),
    bank.config.assetWeightInit
  );
  const assetWeightMaint = BigNumber.max(
    activeEmodeWeights?.assetWeightMaint ?? BigNumber(0),
    bank.config.assetWeightMaint
  );

  switch (marginRequirement) {
    case MarginRequirementType.Initial:
      const isSoftLimitDisabled = bank.config.totalAssetValueInitLimit.isZero();
      if (ignoreSoftLimits || isSoftLimitDisabled) return assetWeightInit;
      const totalBankCollateralValue = computeAssetUsdValue({
        bank,
        oraclePrice,
        assetShares: bank.totalAssetShares,
        marginRequirement: MarginRequirementType.Equity,
        priceBias: PriceBias.Lowest,
        assetShareValueMultiplier,
        activeEmodeWeights,
      });
      if (totalBankCollateralValue.isGreaterThan(bank.config.totalAssetValueInitLimit)) {
        return bank.config.totalAssetValueInitLimit
          .div(totalBankCollateralValue)
          .times(assetWeightInit);
      } else {
        return assetWeightInit;
      }
    case MarginRequirementType.Maintenance:
      return assetWeightMaint;
    case MarginRequirementType.Equity:
      return new BigNumber(1);
    default:
      throw new Error("Invalid margin requirement type");
  }
}

/**
 * Computes the liability weight for a bank based on margin requirement type.
 *
 * Liability weights determine how much a borrowed position counts against health:
 * - **Initial**: Weight for opening new borrows
 * - **Maintenance**: Weight for liquidation threshold
 * - **Equity**: No weighting (1.0)
 *
 * Higher weights mean more conservative (borrow counts more against health).
 *
 * @param config - The bank configuration containing weight parameters
 * @param marginRequirementType - Which margin requirement level
 * @returns Liability weight as a decimal (e.g., 1.1 means borrow counts as 110% of value)
 *
 * @example
 * ```typescript
 * const weight = getLiabilityWeight(bank.config, MarginRequirementType.Initial);
 * ```
 */
export function getLiabilityWeight(
  config: BankConfigType,
  marginRequirementType: MarginRequirementType
): BigNumber {
  switch (marginRequirementType) {
    case MarginRequirementType.Initial:
      return config.liabilityWeightInit;
    case MarginRequirementType.Maintenance:
      return config.liabilityWeightMaint;
    case MarginRequirementType.Equity:
      return new BigNumber(1);
    default:
      throw new Error("Invalid margin requirement type");
  }
}

/**
 * Computes the maximum leverage achievable between deposit and borrow banks.
 *
 * Max leverage is determined by the loan-to-value (LTV) ratio, which is the ratio
 * of asset weight to liability weight. The formula is: `maxLeverage = 1 / (1 - LTV)`.
 *
 * @param depositBank - The bank being used as collateral
 * @param borrowBank - The bank being borrowed against
 * @param opts - Optional weight overrides
 * @param opts.assetWeightInit - Override deposit bank's initial asset weight
 * @param opts.liabilityWeightInit - Override borrow bank's initial liability weight
 * @returns Object containing maxLeverage and ltv (loan-to-value ratio)
 *
 * @example
 * ```typescript
 * const { maxLeverage, ltv } = computeMaxLeverage(solBank, usdcBank);
 * console.log(`Max leverage: ${maxLeverage.toFixed(2)}x, LTV: ${(ltv * 100).toFixed(1)}%`);
 * ```
 */
export function computeMaxLeverage(
  depositBank: BankType,
  borrowBank: BankType,
  opts?: { assetWeightInit?: BigNumber; liabilityWeightInit?: BigNumber }
): { maxLeverage: number; ltv: number } {
  const assetWeightInit = opts?.assetWeightInit || depositBank.config.assetWeightInit;
  const liabilityWeightInit = opts?.liabilityWeightInit || borrowBank.config.liabilityWeightInit;

  const ltv = assetWeightInit.div(liabilityWeightInit).toNumber();
  const maxLeverage = 1 / (1 - ltv);

  return {
    maxLeverage,
    ltv,
  };
}

/**
 * Computes the total deposit and borrow amounts needed to achieve a target leverage.
 *
 * This is used for leveraged looping strategies where you:
 * 1. Deposit collateral
 * 2. Borrow against it
 * 3. Swap borrowed assets to deposit asset
 * 4. Repeat to achieve desired leverage
 *
 * The target leverage is automatically clamped between 1x and the maximum achievable leverage.
 *
 * @param principal - Initial collateral amount (in deposit token)
 * @param targetLeverage - Desired leverage multiplier (e.g., 3 for 3x)
 * @param depositBank - The bank receiving deposits
 * @param borrowBank - The bank being borrowed from
 * @param depositOracleInfo - Oracle price for deposit asset
 * @param borrowOracleInfo - Oracle price for borrow asset
 * @param opts - Optional weight overrides
 * @returns Total amounts needed (totalDepositAmount, totalBorrowAmount)
 *
 * @example
 * ```typescript
 * const { totalDepositAmount, totalBorrowAmount } = computeLoopingParams(
 *   new BigNumber(1000), // 1000 SOL principal
 *   3,                   // 3x leverage
 *   solBank,
 *   usdcBank,
 *   solOraclePrice,
 *   usdcOraclePrice
 * );
 * ```
 */
export function computeLoopingParams(
  principal: Amount,
  targetLeverage: number,
  depositBank: BankType,
  borrowBank: BankType,
  depositOracleInfo: OraclePrice,
  borrowOracleInfo: OraclePrice,
  opts?: { assetWeightInit?: BigNumber; liabilityWeightInit?: BigNumber }
): { totalBorrowAmount: BigNumber; totalDepositAmount: BigNumber } {
  const initialCollateral = toBigNumber(principal);
  const { maxLeverage } = computeMaxLeverage(depositBank, borrowBank, opts);

  // Clamp target leverage to valid range instead of throwing
  let clampedLeverage = targetLeverage;

  if (targetLeverage < 1) {
    console.warn(`computeLoopingParams: targetLeverage ${targetLeverage} < 1, clamping to 1`);
    clampedLeverage = 1;
  } else if (targetLeverage > maxLeverage) {
    console.warn(
      `computeLoopingParams: targetLeverage ${targetLeverage} > maxLeverage ${maxLeverage}, clamping to ${maxLeverage}`
    );
    clampedLeverage = maxLeverage;
  }

  const totalDepositAmount = initialCollateral.times(new BigNumber(clampedLeverage));
  const additionalDepositAmount = totalDepositAmount.minus(initialCollateral);
  const totalBorrowAmount = additionalDepositAmount
    .times(depositOracleInfo.priceWeighted.lowestPrice)
    .div(borrowOracleInfo.priceWeighted.highestPrice);

  return {
    totalBorrowAmount: totalBorrowAmount.decimalPlaces(
      borrowBank.mintDecimals,
      BigNumber.ROUND_DOWN
    ),
    totalDepositAmount: totalDepositAmount.decimalPlaces(
      depositBank.mintDecimals,
      BigNumber.ROUND_DOWN
    ),
  };
}

/**
 * Configuration for computing USD value from token quantity
 */
export interface ComputeUsdValueParams {
  /** The bank for decimal scaling */
  bank: BankType;
  /** Oracle price data */
  oraclePrice: OraclePrice;
  /** Token quantity to value */
  quantity: BigNumber;
  /** Price bias to apply (None, Lowest, Highest) */
  priceBias: PriceBias;
  /** Whether to use weighted (EMA) or spot price */
  isWeightedPrice: boolean;
  /** Collateral/liability weight to apply (default: 1) */
  weight?: BigNumber;
  /** Whether to scale by token decimals (default: true) */
  scaleToBase?: boolean;
  /** Asset share value multiplier for integrated protocols (Kamino, Drift) */
  assetShareValueMultiplier?: BigNumber;
}

/**
 * Core USD value computation from token quantity.
 *
 * This is the fundamental pricing function that:
 * 1. Retrieves the appropriate price (spot or weighted, with bias)
 * 2. Applies asset share multiplier for integrated protocols
 * 3. Applies collateral/liability weight
 * 4. Scales by token decimals to get USD value
 *
 * @param params - Configuration object for USD value computation
 * @returns USD value of the token quantity
 *
 * @example
 * ```typescript
 * // Basic asset valuation
 * const usdValue = computeUsdValue({
 *   bank,
 *   oraclePrice,
 *   quantity: new BigNumber(100),
 *   priceBias: PriceBias.Lowest,
 *   weightedPrice: true,
 *   weight: new BigNumber(0.9), // 90% weight
 * });
 *
 * // Kamino integration with multiplier
 * const kaminoValue = computeUsdValue({
 *   bank,
 *   oraclePrice,
 *   quantity: new BigNumber(100),
 *   priceBias: PriceBias.Lowest,
 *   weightedPrice: true,
 *   weight: new BigNumber(0.9),
 *   assetShareValueMultiplier: kaminoMultiplier,
 * });
 * ```
 */
export function computeUsdValue(params: ComputeUsdValueParams): BigNumber {
  const {
    bank,
    oraclePrice,
    quantity,
    priceBias,
    isWeightedPrice,
    weight = new BigNumber(1),
    scaleToBase = true,
    assetShareValueMultiplier,
  } = params;

  const price = getPrice(oraclePrice, priceBias, isWeightedPrice);
  return quantity
    .times(assetShareValueMultiplier ?? 1)
    .times(price)
    .times(weight)
    .dividedBy(scaleToBase ? 10 ** bank.mintDecimals : 1);
}

/**
 * Configuration for computing liability USD value
 */
export interface ComputeLiabilityUsdValueParams {
  /** The bank containing the liability */
  bank: BankType;
  /** Oracle price data */
  oraclePrice: OraclePrice;
  /** Number of liability shares */
  liabilityShares: BigNumber;
  /** Which margin level (Initial, Maintenance, Equity) */
  marginRequirement: MarginRequirementType;
  /** Price bias to apply (Highest for conservative liability valuation) */
  priceBias: PriceBias;
}

/**
 * Computes the USD value of a liability position (borrow).
 *
 * Converts liability shares to quantity, applies price and liability weight.
 *
 * @param params - Configuration object for liability USD value computation
 * @returns Weighted USD value of the liability
 *
 * @example
 * ```typescript
 * const liabilityValue = computeLiabilityUsdValue({
 *   bank,
 *   oraclePrice,
 *   liabilityShares: new BigNumber(50),
 *   marginRequirement: MarginRequirementType.Initial,
 *   priceBias: PriceBias.Highest,
 * });
 * ```
 */
export function computeLiabilityUsdValue(params: ComputeLiabilityUsdValueParams): BigNumber {
  const { bank, oraclePrice, liabilityShares, marginRequirement, priceBias } = params;

  const liabilityQuantity = getLiabilityQuantity(bank, liabilityShares);
  const liabilityWeight = getLiabilityWeight(bank.config, marginRequirement);
  const isWeighted = isWeightedPrice(marginRequirement);
  return computeUsdValue({
    bank,
    oraclePrice,
    quantity: liabilityQuantity,
    priceBias,
    isWeightedPrice: isWeighted,
    weight: liabilityWeight,
  });
}

/**
 * Configuration for computing asset USD value
 */
export interface ComputeAssetUsdValueParams {
  /** The bank containing the asset */
  bank: BankType;
  /** Oracle price data */
  oraclePrice: OraclePrice;
  /** Number of asset shares */
  assetShares: BigNumber;
  /** Which margin level (Initial, Maintenance, Equity) */
  marginRequirement: MarginRequirementType;
  /** Price bias to apply (Lowest for conservative asset valuation) */
  priceBias: PriceBias;
  /** Asset share value multiplier for integrated protocols (Kamino, Drift) */
  assetShareValueMultiplier?: BigNumber;
  /** Optional emode weight overrides */
  activeEmodeWeights?: {
    assetWeightMaint: BigNumber;
    assetWeightInit: BigNumber;
  };
}

/**
 * Computes the USD value of an asset position (deposit).
 *
 * Converts asset shares to quantity, applies price and asset weight (including soft limits).
 *
 * @param params - Configuration object for asset USD value computation
 * @returns Weighted USD value of the asset
 *
 * @example
 * ```typescript
 * const assetValue = computeAssetUsdValue({
 *   bank,
 *   oraclePrice,
 *   assetShares: new BigNumber(100),
 *   marginRequirement: MarginRequirementType.Initial,
 *   priceBias: PriceBias.Lowest,
 * });
 * ```
 */
export function computeAssetUsdValue(params: ComputeAssetUsdValueParams): BigNumber {
  const {
    bank,
    oraclePrice,
    assetShares,
    marginRequirement,
    priceBias,
    assetShareValueMultiplier,
    activeEmodeWeights,
  } = params;
  // Asset Quantity is the amount of the asset in the bank
  // For integrated protocols like Kamino/Drift, this is the collateral token amount (ctoken)
  // For regular banks this is the token amount
  const assetQuantity = getAssetQuantity(bank, assetShares);
  const assetWeight = getAssetWeight({
    bank,
    marginRequirement,
    oraclePrice,
    assetShareValueMultiplier,
    activeEmodeWeights,
  });
  const isWeighted = isWeightedPrice(marginRequirement);
  return computeUsdValue({
    bank,
    oraclePrice,
    quantity: assetQuantity,
    priceBias,
    isWeightedPrice: isWeighted,
    weight: assetWeight,
    assetShareValueMultiplier,
  });
}

/**
 * Computes the Total Value Locked (TVL) for a bank.
 *
 * TVL = (Total Assets USD Value) - (Total Liabilities USD Value)
 *
 * Uses Equity margin requirement (no weighting) and neutral price bias.
 *
 * @param bank - The bank to compute TVL for
 * @param oraclePrice - Oracle price data
 * @returns Net TVL in USD
 *
 * @example
 * ```typescript
 * const tvl = computeTvl(usdcBank, usdcOraclePrice);
 * console.log(`Bank TVL: $${tvl.toFormat(2)}`);
 * ```
 */
export function computeTvl(bank: BankType, oraclePrice: OraclePrice): BigNumber {
  return computeAssetUsdValue({
    bank,
    oraclePrice,
    assetShares: bank.totalAssetShares,
    marginRequirement: MarginRequirementType.Equity,
    priceBias: PriceBias.None,
  }).minus(
    computeLiabilityUsdValue({
      bank,
      oraclePrice,
      liabilityShares: bank.totalLiabilityShares,
      marginRequirement: MarginRequirementType.Equity,
      priceBias: PriceBias.None,
    })
  );
}
