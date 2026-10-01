import { BigNumber } from "bignumber.js";

import { BalanceType } from "../../types";

import { BankType, getLiabilityQuantity, SECONDS_PER_YEAR } from "~/services/bank";

/**
 * Variable borrow premium owed by a balance, in native units of the bank's mint: the premium
 * already accrued into the balance plus simple interest at the stored rate since its last update,
 * counted from no earlier than the bank's premium activation. Zero unless the bank has premium
 * active and the balance is a liability. Mirrors the program's `accrued_premium_total`.
 *
 * @param balance - The balance to compute the premium for
 * @param bank - The balance's bank
 * @param nowSeconds - Unix time in seconds to accrue up to (default: now)
 * @returns Premium owed in native units
 */
export function computeBalancePremium(
  balance: BalanceType,
  bank: BankType,
  nowSeconds = Date.now() / 1000
): BigNumber {
  if (!bank.premiumActive || balance.liabilityShares.lte(0)) {
    return new BigNumber(0);
  }

  const accrualStart = Math.max(balance.lastUpdate, bank.premiumActivatedAt);
  const elapsedSeconds = balance.lastUpdate === 0 ? 0 : Math.max(0, nowSeconds - accrualStart);

  return balance.premiumOutstanding.plus(
    getLiabilityQuantity(bank, balance.liabilityShares)
      .times(balance.premiumRate)
      .times(elapsedSeconds)
      .div(SECONDS_PER_YEAR)
  );
}
