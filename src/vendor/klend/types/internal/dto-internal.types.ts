export interface LastUpdateJSON {
  /** Last slot when updated */
  slot: string;
  /** True when marked stale, false when slot updated */
  stale: number;
  /** Status of the prices used to calculate the last update */
  priceStatus: number;
  placeholder: Array<number>;
}

export interface BigFractionBytesJSON {
  value: Array<string>;
  padding: Array<string>;
}
