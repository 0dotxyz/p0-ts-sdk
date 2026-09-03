import { KaminoReserve } from "../../types";

import { calculateUtilizationRatio } from "./interest-rate.utils";

function calculateSupplyAPR(reserve: KaminoReserve, referralFeeBps: number) {
  const currentUtilization = calculateUtilizationRatio(reserve);

  //   const borrowRate = this.calculateEstimatedBorrowRate(slot, referralFeeBps);
  //   const protocolTakeRatePct = 1 - this.state.config.protocolTakeRatePct / 100;
  //   return currentUtilization * borrowRate * protocolTakeRatePct;
}
