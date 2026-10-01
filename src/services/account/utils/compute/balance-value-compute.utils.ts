import BigNumber from "bignumber.js";

import { BalanceType, MarginRequirementType } from "../../types";

import { computeBalancePremium } from "./premium-compute.utils";

import {
  BankType,
  computeAssetUsdValue,
  computeUsdValue,
  getAssetQuantity,
  getLiabilityQuantity,
  getLiabilityWeight,
  isWeightedPrice,
} from "~/services/bank";
import { OraclePrice, PriceBias } from "~/services/price";
import { nativeToUi } from "~/utils";

/**
 * Balance Value & Quantity Calculations
 * =====================================
 */

/**
 * Configuration for computing balance USD value
 */
export interface ComputeBalanceUsdValueParams {
  /** The balance to compute USD value for */
  balance: BalanceType;
  /** The bank containing the balance */
  bank: BankType;
  /** Oracle price data */
  oraclePrice: OraclePrice;
  /** Which margin level (Initial, Maintenance, Equity) */
  marginRequirement: MarginRequirementType;
  /** Asset share value multiplier for integrated protocols (Kamino, Drift) */
  assetShareValueMultiplier?: BigNumber;
  /** Optional emode weight overrides */
  activeEmodeWeights?: {
    assetWeightInit: BigNumber;
    assetWeightMaint: BigNumber;
  };
}

/**
 * Computes the USD value of both assets and liabilities for a balance.
 *
 * This function returns the USD value of the position's assets (deposits) and
 * liabilities (borrows, including accrued variable borrow premium) separately, using neutral
 * price bias (no conservative adjustments).
 *
 * @param params - Configuration object for balance USD value computation
 * @returns Object containing assets and liabilities USD values
 *
 * @example
 * ```typescript
 * const { assets, liabilities } = computeBalanceUsdValue({
 *   balance,
 *   bank,
 *   oraclePrice,
 *   marginRequirement: MarginRequirementType.Initial,
 * });
 * console.log(`Assets: $${assets.toFormat(2)}, Liabilities: $${liabilities.toFormat(2)}`);
 * ```
 */
export function computeBalanceUsdValue(params: ComputeBalanceUsdValueParams): {
  assets: BigNumber;
  liabilities: BigNumber;
} {
  const {
    balance,
    bank,
    oraclePrice,
    marginRequirement,
    assetShareValueMultiplier,
    activeEmodeWeights,
  } = params;

  const assetsValue = computeAssetUsdValue({
    bank,
    oraclePrice,
    assetShares: balance.assetShares,
    marginRequirement,
    priceBias: PriceBias.None,
    activeEmodeWeights,
    assetShareValueMultiplier,
  });
  const liabilitiesValue = computeBalanceLiabilityUsdValue(
    balance,
    bank,
    oraclePrice,
    marginRequirement,
    PriceBias.None
  );
  return { assets: assetsValue, liabilities: liabilitiesValue };
}

/**
 * Configuration for computing balance USD value with price bias
 */
export interface GetBalanceUsdValueWithPriceBiasParams {
  /** The balance to compute USD value for */
  balance: BalanceType;
  /** The bank containing the balance */
  bank: BankType;
  /** Oracle price data */
  oraclePrice: OraclePrice;
  /** Which margin level (Initial, Maintenance, Equity) */
  marginRequirement: MarginRequirementType;
  /** Asset share value multiplier for integrated protocols (Kamino, Drift) */
  assetShareValueMultiplier?: BigNumber;
  /** Optional emode weight overrides */
  activeEmodeWeights?: {
    assetWeightInit: BigNumber;
    assetWeightMaint: BigNumber;
  };
}

/**
 * Computes the USD value of both assets and liabilities with conservative price bias.
 *
 * This function applies conservative pricing for risk management:
 * - **Assets**: Uses Lowest price (conservative collateral valuation)
 * - **Liabilities**: Uses Highest price (conservative debt valuation), including accrued premium
 *
 * This is more conservative than `computeBalanceUsdValue` which uses neutral pricing.
 * Typically used for health checks and liquidation thresholds.
 *
 * @param params - Configuration object for balance USD value computation
 * @returns Object containing assets and liabilities USD values with conservative bias
 *
 * @example
 * ```typescript
 * const { assets, liabilities } = getBalanceUsdValueWithPriceBias({
 *   balance,
 *   bank,
 *   oraclePrice,
 *   marginRequirement: MarginRequirementType.Maintenance,
 * });
 * // Conservative health factor calculation
 * const healthFactor = assets.div(liabilities);
 * ```
 */
export function getBalanceUsdValueWithPriceBias(params: GetBalanceUsdValueWithPriceBiasParams): {
  assets: BigNumber;
  liabilities: BigNumber;
} {
  const {
    balance,
    bank,
    oraclePrice,
    marginRequirement,
    assetShareValueMultiplier,
    activeEmodeWeights,
  } = params;

  const assetsValue = computeAssetUsdValue({
    bank,
    oraclePrice,
    assetShares: balance.assetShares,
    marginRequirement,
    priceBias: PriceBias.Lowest,
    activeEmodeWeights,
    assetShareValueMultiplier,
  });
  const liabilitiesValue = computeBalanceLiabilityUsdValue(
    balance,
    bank,
    oraclePrice,
    marginRequirement,
    PriceBias.Highest
  );
  return { assets: assetsValue, liabilities: liabilitiesValue };
}

/**
 * Computes the native token quantities for a balance.
 *
 * Converts balance shares to actual token amounts in native units (no decimal scaling).
 * Liabilities are the full debt: principal plus accrued variable borrow premium, which is what
 * `repay_all` collects and what health checks charge.
 *
 * @param balance - The balance to compute quantities for
 * @param bank - The bank containing the balance
 * @returns Object with assets and liabilities in native token amounts
 */
export function computeQuantity(
  balance: BalanceType,
  bank: BankType
): {
  assets: BigNumber;
  liabilities: BigNumber;
} {
  const assetsQuantity = getAssetQuantity(bank, balance.assetShares);
  const liabilitiesQuantity = getLiabilityQuantity(bank, balance.liabilityShares).plus(
    computeBalancePremium(balance, bank)
  );
  return { assets: assetsQuantity, liabilities: liabilitiesQuantity };
}

/**
 * Computes the UI-formatted token quantities for a balance.
 *
 * This function:
 * 1. Converts shares → native token amounts
 * 2. (Optional) Applies cToken exchange rate for integrated protocols
 * 3. Scales by token decimals for UI display
 *
 * **For integrated protocols (Kamino, Drift):**
 * The `assetShareValueMultiplier` converts cToken amounts to underlying token amounts.
 * This is crucial because oracle prices are denominated in the underlying token, not the cToken.
 *
 * @param balance - The balance to compute quantities for
 * @param bank - The bank containing the balance
 * @param assetShareValueMultiplier - Exchange rate for cToken → underlying conversion (Kamino, Drift)
 * @returns Object with assets and liabilities in UI-formatted amounts
 *
 * @example
 * ```typescript
 * // Regular bank (USDC)
 * const { assets, liabilities } = computeQuantityUi(balance, usdcBank);
 * console.log(`Deposited: ${assets.toFixed(2)} USDC`);
 *
 * // Kamino bank (kUSDC → USDC)
 * const kaminoRate = getDriftCTokenMultiplier(kaminoMarket);
 * const { assets, liabilities } = computeQuantityUi(balance, kaminoBank, kaminoRate);
 * console.log(`Deposited: ${assets.toFixed(2)} USDC (underlying)`);
 * // Now assets matches oracle pricing which is in USDC, not kUSDC
 * ```
 */
export function computeQuantityUi(
  balance: BalanceType,
  bank: BankType,
  assetShareValueMultiplier?: BigNumber
): {
  assets: BigNumber;
  liabilities: BigNumber;
} {
  const { assets, liabilities } = computeQuantity(balance, bank);

  // For integrated protocols, convert cToken amount to underlying amount
  // This matches oracle pricing which is denominated in the underlying token
  const adjustedAssets = assetShareValueMultiplier
    ? assets.multipliedBy(assetShareValueMultiplier)
    : assets;

  const assetsQuantity = new BigNumber(nativeToUi(adjustedAssets, bank.mintDecimals));
  const liabilitiesQuantity = new BigNumber(nativeToUi(liabilities, bank.mintDecimals));
  return { assets: assetsQuantity, liabilities: liabilitiesQuantity };
}

function computeBalanceLiabilityUsdValue(
  balance: BalanceType,
  bank: BankType,
  oraclePrice: OraclePrice,
  marginRequirement: MarginRequirementType,
  priceBias: PriceBias
): BigNumber {
  return computeUsdValue({
    bank,
    oraclePrice,
    quantity: computeQuantity(balance, bank).liabilities,
    priceBias,
    isWeightedPrice: isWeightedPrice(marginRequirement),
    weight: getLiabilityWeight(bank.config, marginRequirement),
  });
}
