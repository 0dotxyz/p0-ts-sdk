import BigNumber from "bignumber.js";

import { KaminoReserve, scaledSupplies } from "~/vendor/klend";

export function getKaminoCTokenMultiplier(reserve: KaminoReserve): BigNumber {
  const [totalLiquidity, totalCollateral] = scaledSupplies(reserve);

  return totalCollateral.isZero()
    ? new BigNumber(1)
    : new BigNumber(totalLiquidity.dividedBy(totalCollateral).toString());
}
