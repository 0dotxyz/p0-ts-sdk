import type { Address } from "@solana/kit";
import { BigNumber } from "bignumber.js";

import { BalanceType, MarginfiAccountType, OrderType } from "../types";

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
export function createEmptyBalance(bankPk: Address): BalanceType {
  const balance: BalanceType = {
    active: false,
    bankPk,
    tag: 0,
    assetShares: new BigNumber(0),
    liabilityShares: new BigNumber(0),
    premiumRate: new BigNumber(0),
    premiumOutstanding: new BigNumber(0),
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
export function getBalance(bankAddress: Address, balances: BalanceType[]): BalanceType {
  return (
    balances.filter((b) => b.active).find((b) => b.bankPk === bankAddress) ??
    createEmptyBalance(bankAddress)
  );
}

function floor(value: number, decimals: number): number {
  return Math.floor(value * 10 ** decimals) / 10 ** decimals;
}

function ceil(value: number, decimals: number): number {
  return Math.ceil(value * 10 ** decimals) / 10 ** decimals;
}

export function computeClosePositionTokenAmount(
  position: { amount: number; isLending: boolean },
  mintDecimals: number
): number {
  const closePositionTokenAmount = position.isLending
    ? floor(position.amount, mintDecimals)
    : ceil(position.amount, mintDecimals);
  return closePositionTokenAmount;
}

export function isWholePosition(
  position: { amount: number; isLending: boolean },
  amount: number,
  mintDecimals: number
): boolean {
  const closePositionTokenAmount = computeClosePositionTokenAmount(position, mintDecimals);
  return amount >= closePositionTokenAmount;
}

// The program's `EMPTY_BALANCE_THRESHOLD`: `Balance::get_side` ignores shares below 1, and a deposit
// that pays off a debt can leave such dust liability shares on what is now a collateral balance.
const EMPTY_BALANCE_THRESHOLD = 1;

/**
 * Maps an order's balance tags to the collateral (asset) and debt (liability) banks of the
 * account that owns it, without throwing: a leg whose tagged balance was closed comes back null
 * (the order is orphaned and can no longer execute). The tag order in `order.tags` follows the
 * caller-supplied bank key order at placement time, so the side is inferred from the balances.
 *
 * @param marginfiAccount - The parsed marginfi account that owns the order
 * @param order - The order whose bank pair to resolve
 */
export function resolveOrderLegs(
  marginfiAccount: MarginfiAccountType,
  order: Pick<OrderType, "tags">
): { collateralBank: Address | null; debtBank: Address | null } {
  const taggedBalances = marginfiAccount.balances.filter(
    (balance) => balance.active && balance.tag !== 0 && order.tags.includes(balance.tag)
  );

  return {
    collateralBank:
      taggedBalances.find(
        (balance) =>
          balance.liabilityShares.lt(EMPTY_BALANCE_THRESHOLD) &&
          balance.assetShares.gte(EMPTY_BALANCE_THRESHOLD)
      )?.bankPk ?? null,
    debtBank:
      taggedBalances.find((balance) => balance.liabilityShares.gte(EMPTY_BALANCE_THRESHOLD))
        ?.bankPk ?? null,
  };
}
