import BigNumber from "bignumber.js";

import { DriftSpotMarket } from "~/vendor/drift";

export function getDriftCTokenMultiplier(spotMarket: DriftSpotMarket): BigNumber {
  const cumulativeDepositInterest = new BigNumber(spotMarket.cumulativeDepositInterest.toNumber());

  const SPOT_BALANCE_PRECISION = new BigNumber(10).pow(19 - spotMarket.decimals);

  return cumulativeDepositInterest.dividedBy(SPOT_BALANCE_PRECISION);
}
