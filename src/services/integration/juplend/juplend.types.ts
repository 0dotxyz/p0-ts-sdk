import BN from "bn.js";
import type {
  JupLendingState,
  JupLendingStateJSON,
  JupTokenReserve,
  JupTokenReserveJSON,
  JupLendingRewardsRateModel,
  JupLendingRewardsRateModelJSON,
  JupRateModel,
  JupRateModelJSON,
} from "~/vendor/jup-lend";

export type JupLendStateJsonByBank = Record<
  string,
  {
    jupLendingState: JupLendingStateJSON;
    jupTokenReserveState: JupTokenReserveJSON;
    jupRewardsRateModel: JupLendingRewardsRateModelJSON | null;
    jupRateModel: JupRateModelJSON | null;
    fTokenTotalSupply: string;
  }
>;

export type JupLendStateByBank = Record<
  string,
  {
    jupLendingState: JupLendingState;
    jupTokenReserveState: JupTokenReserve;
    jupRewardsRateModel: JupLendingRewardsRateModel | null;
    jupRateModel: JupRateModel | null;
    fTokenTotalSupply: BN;
  }
>;
