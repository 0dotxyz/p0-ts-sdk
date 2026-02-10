import BigNumber from "bignumber.js";

import { BankType } from "~/services/bank";

import { BalanceType } from "../../types";
import { computeQuantity } from "./balance-value-compute.utils";

/**
 * Emissions Calculations
 * =====================
 */

/**
 * Computes the emissions accrued for a balance since its last update.
 *
 * This function calculates emissions based on:
 * - The time elapsed since the balance was last updated
 * - The bank's emissions rate (tokens per year)
 * - Whether lending or borrowing emissions are active
 * - The balance's asset or liability amount
 *
 * The calculation is capped by the bank's remaining emissions.
 *
 * @deprecated This function is deprecated. Emissions are now distributed offchain and should not be used in new code.
 *
 * @param balance - The account balance to compute emissions for
 * @param bank - The bank configuration containing emissions parameters
 * @param currentTimestamp - Current timestamp in seconds (Unix time)
 * @returns Newly accrued emissions since last update (not yet claimed)
 *
 * @example
 * ```typescript
 * // Calculate emissions accrued up to now
 * const emissions = computeClaimedEmissions(
 *   balance,
 *   bank,
 *   Date.now() / 1000
 * );
 * ```
 */
export function computeClaimedEmissions(
  balance: BalanceType,
  bank: BankType,
  currentTimestamp: number
): BigNumber {
  const lendingActive = bank.emissionsActiveLending;
  const borrowActive = bank.emissionsActiveBorrowing;

  const { assets, liabilities } = computeQuantity(balance, bank);

  let balanceAmount: BigNumber | null = null;

  if (lendingActive) {
    balanceAmount = assets;
  } else if (borrowActive) {
    balanceAmount = liabilities;
  }

  if (balanceAmount) {
    const lastUpdate = balance.lastUpdate;
    const period = new BigNumber(currentTimestamp - lastUpdate);
    const emissionsRate = new BigNumber(bank.emissionsRate);
    const emissions = period
      .times(balanceAmount)
      .times(emissionsRate)
      .div(31_536_000 * Math.pow(10, bank.mintDecimals));
    const emissionsReal = BigNumber.min(emissions, new BigNumber(bank.emissionsRemaining));

    return emissionsReal;
  }

  return new BigNumber(0);
}

/**
 * Computes the total outstanding emissions for a balance (claimed + unclaimed).
 *
 * @deprecated This function is deprecated. Emissions are now distributed offchain and should not be used in new code.
 *
 * @param balance - The account balance to compute emissions for
 * @param bank - The bank configuration containing emissions parameters
 * @returns Total outstanding emissions (claimed from balance + newly accrued unclaimed)
 */
export function computeTotalOutstandingEmissions(balance: BalanceType, bank: BankType): BigNumber {
  const claimedEmissions = balance.emissionsOutstanding;
  const unclaimedEmissions = computeClaimedEmissions(balance, bank, Date.now() / 1000);
  return claimedEmissions.plus(unclaimedEmissions);
}
