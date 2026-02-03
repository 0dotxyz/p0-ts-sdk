import BigNumber from "bignumber.js";
import { PublicKey } from "@solana/web3.js";

import { BalanceType } from "../../types";

/**
 * Balance Helper Utilities
 * ========================
 */

/**
 * Creates an empty (inactive) balance object for a specific bank.
 *
 * This is useful for initializing balance slots or representing non-existent positions.
 * All numeric fields are set to zero and the balance is marked as inactive.
 *
 * @param bankPk - The public key of the bank this balance is associated with
 * @returns An inactive balance object with all values set to zero
 *
 * @example
 * ```typescript
 * const emptyBalance = createEmptyBalance(bankAddress);
 * // emptyBalance.active === false
 * // emptyBalance.assetShares.eq(0) === true
 * ```
 */
export function createEmptyBalance(bankPk: PublicKey): BalanceType {
  const balance: BalanceType = {
    active: false,
    bankPk,
    assetShares: new BigNumber(0),
    liabilityShares: new BigNumber(0),
    emissionsOutstanding: new BigNumber(0),
    lastUpdate: 0,
  };

  return balance;
}

/**
 * Filters an array of balances to return only active positions.
 *
 * Active balances are positions that currently have assets or liabilities.
 * Inactive balances are empty slots available for new positions.
 *
 * @param balances - Array of account balances to filter
 * @returns Array containing only balances where `active === true`
 *
 * @example
 * ```typescript
 * const activePositions = getActiveBalances(account.balances);
 * // Returns only balances with actual assets or liabilities
 * ```
 */
export function getActiveBalances(balances: BalanceType[]): BalanceType[] {
  return balances.filter((b) => b.active);
}

/**
 * Retrieves the balance for a specific bank address from an array of balances.
 *
 * If an active balance is found for the bank, it is returned. Otherwise, an empty
 * (inactive) balance is created for that bank address.
 *
 * This function is safe to use without null checks - it always returns a valid balance object.
 *
 * @param bankAddress - The public key of the bank to look up
 * @param balances - Array of account balances to search
 * @returns The active balance if found, otherwise a newly created empty balance
 *
 * @example
 * ```typescript
 * const usdcBalance = getBalance(usdcBankAddress, account.balances);
 * if (usdcBalance.active) {
 *   // User has a USDC position
 *   console.log("Assets:", usdcBalance.assetShares);
 * } else {
 *   // User has no USDC position (empty balance returned)
 * }
 * ```
 */
export function getBalance(bankAddress: PublicKey, balances: BalanceType[]): BalanceType {
  return (
    balances.filter((b) => b.active).find((b) => b.bankPk.equals(bankAddress)) ??
    createEmptyBalance(bankAddress)
  );
}
