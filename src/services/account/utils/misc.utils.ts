import { BigNumber } from "bignumber.js";

import { BalanceType } from "../types";

import { MAX_COSTLY_POSITIONS } from "~/constants";
import { AssetTag, BankType } from "~/services/bank";

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
  if (!isCostlyBank(bank) || active.some((balance) => balance.bankPk.equals(bank.address))) {
    return false;
  }
  const held = active.filter((balance) => {
    const heldBank = bankMap.get(balance.bankPk.toBase58());
    return heldBank !== undefined && isCostlyBank(heldBank);
  }).length;
  return held >= MAX_COSTLY_POSITIONS;
}
