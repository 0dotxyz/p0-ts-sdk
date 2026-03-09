import BigNumber from "bignumber.js";
import BN from "bn.js";

import { JupLendingState, JupLendingRewardsRateModel, JupTokenReserve } from "~/vendor/jup-lend";
import {
  calculateJupLendNewExchangePrice,
  JUP_EXCHANGE_PRICES_PRECISION,
} from "~/vendor/jup-lend/utils/interest-rate.utils";

/**
 * Compute the fToken → native multiplier for a JupLend market.
 * Analogous to `getDriftCTokenMultiplier`.
 *
 * Formula: newExchangePrice / EXCHANGE_PRICES_PRECISION (1e12)
 *
 * Multiply the result by an fToken share amount to get the equivalent
 * native token amount (in lamports / base units).
 *
 * @param lendingState - The on-chain Lending account
 * @param tokenReserve - The on-chain TokenReserve account
 * @param rewardsModel - The on-chain LendingRewardsRateModel (or null)
 * @param fTokenTotalSupply - Total supply of the fToken mint (raw amount)
 * @param nowSeconds - Current unix timestamp in seconds
 * @returns Multiplier as BigNumber (e.g. 1.05 means 1 fToken = 1.05 native tokens)
 */
export function getJupLendFTokenMultiplier(
  lendingState: JupLendingState,
  tokenReserve: JupTokenReserve,
  rewardsModel: JupLendingRewardsRateModel | null,
  fTokenTotalSupply: BN,
  nowSeconds: number
): BigNumber {
  const currentTimestamp = new BN(nowSeconds);

  const newExchangePrice = calculateJupLendNewExchangePrice(
    lendingState,
    tokenReserve,
    rewardsModel,
    fTokenTotalSupply,
    currentTimestamp
  );

  return new BigNumber(newExchangePrice.toString()).dividedBy(
    new BigNumber(JUP_EXCHANGE_PRICES_PRECISION.toString())
  );
}
