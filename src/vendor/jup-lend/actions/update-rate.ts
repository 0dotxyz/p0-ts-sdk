import { makeUpdateJupLendRateIx } from "../instructions";
import { JupLendingState } from "../types";

type MakeUpdateJupLendRateParams = {
  lendingState: JupLendingState;
};

export function makeUpdateJupLendRate({ lendingState }: MakeUpdateJupLendRateParams) {
  return makeUpdateJupLendRateIx(
    lendingState.pubkey,
    lendingState.mint,
    lendingState.fTokenMint,
    lendingState.tokenReservesLiquidity,
    lendingState.rewardsRateModel
  );
}
