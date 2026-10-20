import type { Address } from "@solana/kit";
import { BigNumber } from "bignumber.js";

import { BalanceType, MarginfiAccountType, OrderType } from "../types";

import { EMPTY_BALANCE_THRESHOLD, MAX_COSTLY_POSITIONS } from "~/constants";
import { AssetTag, BankType } from "~/services/bank";

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

/**
 * The position's `amount` (UI units) rounded to whole native units: down for a deposit (no more
 * can be withdrawn), up for a debt (no less repays it).
 */
export function computeClosePositionTokenAmount(
  position: { amount: number; isLending: boolean },
  mintDecimals: number
): number {
  // Rounded in decimal: in floating point 2.007 * 10 ** 6 is 2007000.0000000002, which
  // `Math.ceil` would round up a whole native unit
  return new BigNumber(position.amount)
    .decimalPlaces(mintDecimals, position.isLending ? BigNumber.ROUND_FLOOR : BigNumber.ROUND_CEIL)
    .toNumber();
}

/**
 * Whether `amount` (UI units) covers the whole position: at least
 * {@link computeClosePositionTokenAmount}.
 */
export function isWholePosition(
  position: { amount: number; isLending: boolean },
  amount: number,
  mintDecimals: number
): boolean {
  const closePositionTokenAmount = computeClosePositionTokenAmount(position, mintDecimals);
  return amount >= closePositionTokenAmount;
}

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

  // A deposit that pays off a debt can leave dust liability shares on what is now a collateral
  // balance; `Balance::get_side` ignores them
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

/**
 * Whether a position in `bank` counts toward the program's per-account limit on integration
 * (Kamino, Drift, Solend, JupLend) and staked positions.
 *
 * @param bank - The bank to check
 * @returns True for integration and staked banks
 */
export function isCostlyBank(bank: BankType): boolean {
  return [
    AssetTag.KAMINO,
    AssetTag.DRIFT,
    AssetTag.SOLEND,
    AssetTag.JUPLEND,
    AssetTag.STAKED,
  ].includes(bank.config.assetTag);
}

/**
 * Whether depositing into `bank` opens a position past the program's limit of
 * {@link MAX_COSTLY_POSITIONS} integration and staked positions. Topping up an existing position
 * never does.
 *
 * @param balances - The account's balances before the deposit
 * @param bankMap - Map of bank addresses to bank data
 * @param bank - The bank deposited into
 * @returns True when the program would reject the deposit (6073)
 */
export function exceedsCostlyPositionLimit(
  balances: BalanceType[],
  bankMap: Map<string, BankType>,
  bank: BankType
): boolean {
  const active = balances.filter((balance) => balance.active);
  if (!isCostlyBank(bank) || active.some((balance) => balance.bankPk === bank.address)) {
    return false;
  }
  const held = active.filter((balance) => {
    const heldBank = bankMap.get(balance.bankPk);
    return heldBank !== undefined && isCostlyBank(heldBank);
  }).length;
  return held >= MAX_COSTLY_POSITIONS;
}
