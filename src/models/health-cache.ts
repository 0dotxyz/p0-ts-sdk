import { BigNumber } from "bignumber.js";

import { HealthCacheFlags, HealthCacheStatus, HealthCacheType } from "../services";
import type { HealthCacheRaw } from "../services/account/types/raw-account.types";
import { parseHealthCacheRaw } from "../services/account/utils/deserialize.utils";
export class HealthCache implements HealthCacheType {
  constructor(
    public assetValue: BigNumber,
    public liabilityValue: BigNumber,
    public assetValueMaint: BigNumber,
    public liabilityValueMaint: BigNumber,
    public assetValueEquity: BigNumber,
    public liabilityValueEquity: BigNumber,
    public timestamp: BigNumber,
    public flags: HealthCacheFlags[],
    public prices: number[][],
    public simulationStatus: HealthCacheStatus
  ) {}

  static fromHealthCacheType(healthCacheType: HealthCacheType): HealthCache {
    return new HealthCache(
      healthCacheType.assetValue,
      healthCacheType.liabilityValue,
      healthCacheType.assetValueMaint,
      healthCacheType.liabilityValueMaint,
      healthCacheType.assetValueEquity,
      healthCacheType.liabilityValueEquity,
      healthCacheType.timestamp,
      healthCacheType.flags,
      healthCacheType.prices,
      healthCacheType.simulationStatus
    );
  }

  static from(healthCacheRaw: HealthCacheRaw): HealthCache {
    return this.fromHealthCacheType(parseHealthCacheRaw(healthCacheRaw));
  }
}
