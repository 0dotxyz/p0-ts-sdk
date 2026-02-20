import type {
  FarmStateJSON,
  FarmStateRaw,
  ObligationJSON,
  ObligationRaw,
  ReserveJSON,
  ReserveRaw,
} from "~/vendor/klend";

export type KaminoStateJsonByBank = Record<
  string,
  {
    reserveState: ReserveJSON;
    obligationState: ObligationJSON;
    farmState?: FarmStateJSON;
  }
>;

export type KaminoStateByBank = Record<
  string,
  {
    reserveState: ReserveRaw;
    obligationState: ObligationRaw;
    farmState?: FarmStateRaw;
  }
>;
