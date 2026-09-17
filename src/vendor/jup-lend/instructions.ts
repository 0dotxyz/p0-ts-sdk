import type { Instruction } from "@solana/kit";

import type { JupLendingState } from "./types";

import { getUpdateRateInstruction } from "~/generated/jup-lend";

/**
 * Refreshes a JupLend market's exchange prices (permissionless crank). Needed before risk-sensitive
 * flows (liquidation, borrow, non-JupLend withdraw) for every involved JupLend bank in the same
 * transaction; juplend_deposit and juplend_withdraw already update the rate internally.
 */
export function makeUpdateJupLendRateIx(lendingState: JupLendingState): Instruction {
  return getUpdateRateInstruction({
    lending: lendingState.pubkey,
    mint: lendingState.mint,
    fTokenMint: lendingState.fTokenMint,
    supplyTokenReservesLiquidity: lendingState.tokenReservesLiquidity,
    rewardsRateModel: lendingState.rewardsRateModel,
  });
}
