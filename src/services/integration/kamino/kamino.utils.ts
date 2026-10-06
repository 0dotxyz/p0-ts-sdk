import BigNumber from "bignumber.js";

import type { BankType } from "~/services/bank";
import { KaminoReserve, scaledSupplies } from "~/vendor/klend";

export function getKaminoCTokenMultiplier(reserve: KaminoReserve): BigNumber {
  const [totalLiquidity, totalCollateral] = scaledSupplies(reserve);

  return totalCollateral.isZero()
    ? new BigNumber(1)
    : new BigNumber(totalLiquidity.dividedBy(totalCollateral).toString());
}

/**
 * Joins a Kamino bank with its reserve's emergency mode. Decoding a bank or converting its DTO
 * only sees the market's emergency (bank flags bit 14), so call this wherever a Kamino bank meets
 * its reserve; otherwise initial health, max borrow and max withdraw overstate borrowing power
 * while the reserve is in emergency.
 *
 * @param bank - The Kamino bank
 * @param reserve - The bank's Kamino reserve
 * @returns The bank, with `kaminoEmergency` also set when the reserve is in emergency mode
 */
export function withKaminoReserveEmergency(bank: BankType, reserve: KaminoReserve): BankType {
  return { ...bank, kaminoEmergency: bank.kaminoEmergency || reserve.config.emergencyMode !== 0 };
}
