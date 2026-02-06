import BigNumber from "bignumber.js";

import { BankType } from "../../types";

/**
 * Share ↔ Quantity Conversion Utilities
 * =====================================
 */

/**
 * Computes the total asset quantity for a bank (all deposits).
 *
 * @param bank - The bank to compute total assets for
 * @returns Total asset quantity across all positions
 */
export function getTotalAssetQuantity(bank: BankType): BigNumber {
  return bank.totalAssetShares.times(bank.assetShareValue);
}

/**
 * Computes the total liability quantity for a bank (all borrows).
 *
 * @param bank - The bank to compute total liabilities for
 * @returns Total liability quantity across all positions
 */
export function getTotalLiabilityQuantity(bank: BankType): BigNumber {
  return bank.totalLiabilityShares.times(bank.liabilityShareValue);
}

/**
 * Converts asset shares to asset quantity.
 *
 * @param bank - The bank containing the share value
 * @param assetShares - The number of asset shares to convert
 * @returns Asset quantity represented by the shares
 *
 * @example
 * ```typescript
 * const quantity = getAssetQuantity(bank, new BigNumber(100));
 * ```
 */
export function getAssetQuantity(bank: BankType, assetShares: BigNumber): BigNumber {
  return assetShares.times(bank.assetShareValue);
}

/**
 * Converts liability shares to token quantity.
 *
 * @param bank - The bank containing the share value
 * @param liabilityShares - The number of liability shares to convert
 * @returns Token quantity represented by the shares
 */
export function getLiabilityQuantity(bank: BankType, liabilityShares: BigNumber): BigNumber {
  return liabilityShares.times(bank.liabilityShareValue);
}

/**
 * Converts token quantity to asset shares.
 *
 * @param bank - The bank containing the share value
 * @param assetQuantity - The token quantity to convert (for integrations, this is the collateral token amount)
 * @returns Number of asset shares representing the quantity (0 if share value is zero)
 */
export function getAssetShares(bank: BankType, assetQuantity: BigNumber): BigNumber {
  if (bank.assetShareValue.isZero()) {
    return new BigNumber(0);
  }
  return assetQuantity.div(bank.assetShareValue);
}

/**
 * Converts token quantity to liability shares.
 *
 * @param bank - The bank containing the share value
 * @param liabilityQuantity - The token quantity to convert
 * @returns Number of liability shares representing the quantity (0 if share value is zero)
 */
export function getLiabilityShares(bank: BankType, liabilityQuantity: BigNumber): BigNumber {
  if (bank.liabilityShareValue.isZero()) {
    return new BigNumber(0);
  }
  return liabilityQuantity.div(bank.liabilityShareValue);
}
