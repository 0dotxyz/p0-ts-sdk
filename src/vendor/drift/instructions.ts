import type { Instruction } from "@solana/kit";

import { deriveDriftSpotMarketVault, deriveDriftState } from "./pda";
import type { DriftSpotMarket } from "./types";

import { getUpdateSpotMarketCumulativeInterestInstruction } from "~/generated/drift";

/**
 * Accrues a Drift spot market's cumulative interest (permissionless crank) so token amounts derived
 * from its scaled balances are current.
 */
export async function makeUpdateSpotMarketCumulativeInterestIx(
  spotMarket: DriftSpotMarket
): Promise<Instruction> {
  const [[state], [spotMarketVault]] = await Promise.all([
    deriveDriftState(),
    deriveDriftSpotMarketVault(spotMarket.marketIndex),
  ]);
  return getUpdateSpotMarketCumulativeInterestInstruction({
    state,
    spotMarket: spotMarket.pubkey,
    oracle: spotMarket.oracle,
    spotMarketVault,
  });
}
