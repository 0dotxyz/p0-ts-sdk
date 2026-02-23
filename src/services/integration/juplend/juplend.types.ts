import type {
  JupLendingState,
  JupLendingStateJSON,
  JupTokenReserve,
  JupTokenReserveJSON,
  JupLendingRewardsRateModel,
  JupLendingRewardsRateModelJSON,
} from "~/vendor/jup-lend";

export type JupLendStateJsonByBank = Record<
  string,
  {
    jupLendingState: JupLendingStateJSON;
    jupTokenReserveState: JupTokenReserveJSON;
    jupRewardsRateModel: JupLendingRewardsRateModelJSON | null;
  }
>;

export type JupLendStateByBank = Record<
  string,
  {
    jupLendingState: JupLendingState;
    jupTokenReserveState: JupTokenReserve;
    jupRewardsRateModel: JupLendingRewardsRateModel | null;
  }
>;
