import BN from "bn.js";

export interface LastUpdateFields {
  /** Last slot when updated */
  slot: BN;
  /** True when marked stale, false when slot updated */
  stale: number;
  /** Status of the prices used to calculate the last update */
  priceStatus: number;
  placeholder: Array<number>;
}

export interface BigFractionBytesFields {
  value: Array<BN>;
  padding: Array<BN>;
}
