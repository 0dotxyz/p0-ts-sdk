import { BalanceType } from "../types";

import { MAX_COSTLY_POSITIONS } from "~/constants";
import { AssetTag, BankType } from "~/services/bank";

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
