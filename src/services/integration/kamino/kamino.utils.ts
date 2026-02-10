import BigNumber from "bignumber.js";

import { ReserveRaw, scaledSupplies } from "~/vendor/klend";

export function getKaminoCTokenMultiplier(reserve: ReserveRaw): BigNumber {
  const [totalLiquidity, totalCollateral] = scaledSupplies(reserve);

  return totalCollateral.isZero()
    ? new BigNumber(1)
    : new BigNumber(totalLiquidity.dividedBy(totalCollateral).toString());
}
