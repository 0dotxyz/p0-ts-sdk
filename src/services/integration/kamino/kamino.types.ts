import type {
  KaminoFarmState,
  KaminoFarmStateJSON,
  KaminoObligation,
  KaminoObligationJSON,
  KaminoReserve,
  KaminoReserveJSON,
} from "~/vendor/klend";

export type KaminoStateJsonByBank = Record<
  string,
  {
    reserveState: KaminoReserveJSON;
    obligationState: KaminoObligationJSON;
    farmState?: KaminoFarmStateJSON;
  }
>;

export type KaminoStateByBank = Record<
  string,
  {
    reserveState: KaminoReserve;
    obligationState: KaminoObligation;
    farmState?: KaminoFarmState;
  }
>;
