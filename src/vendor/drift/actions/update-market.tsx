import driftInstructions from "../instructions";
import { DriftSpotMarket } from "../types";
import { deriveDriftSpotMarketVault, deriveDriftState } from "../utils";

type MakeUpdateSpotMarketIxParams = {
  spotMarket: DriftSpotMarket;
};

export function makeUpdateSpotMarketIx({
  spotMarket,
}: MakeUpdateSpotMarketIxParams) {
  const spotMarketKey = spotMarket.pubkey;
  const spotMarketOracle = spotMarket.oracle;
  const driftState = deriveDriftState()[0];
  const spotMarketVault = deriveDriftSpotMarketVault(spotMarket.marketIndex)[0];

  return driftInstructions.makeUpdateSpotMarketCumulativeInterestIx(
    driftState,
    spotMarketKey,
    spotMarketOracle,
    spotMarketVault
  );
}
