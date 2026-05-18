import type { KaminoFarm, KaminoFarmDto, KaminoReserve, KaminoReserveDto } from "~/vendor/klend";

export type KaminoStateJsonByBank = Record<
  string,
  {
    reserveState: KaminoReserveDto;
    farmState?: KaminoFarmDto;
  }
>;

export type KaminoStateByBank = Record<
  string,
  {
    reserveState: KaminoReserve;
    farmState?: KaminoFarm;
  }
>;
