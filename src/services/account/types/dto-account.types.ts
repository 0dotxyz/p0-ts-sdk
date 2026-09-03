import { AccountFlags, HealthCacheFlags, HealthCacheStatus } from "./account.types";

export interface BalanceTypeDto {
  active: boolean;
  bankPk: string;
  /** Optional for backwards compatibility with DTOs serialized before order tags existed. */
  tag?: number;
  assetShares: string;
  liabilityShares: string;
  emissionsOutstanding: string;
  lastUpdate: number;
}

export interface HealthCacheTypeDto {
  assetValue: string;
  liabilityValue: string;
  assetValueMaint: string;
  liabilityValueMaint: string;
  assetValueEquity: string;
  liabilityValueEquity: string;
  timestamp: string;
  flags: HealthCacheFlags[];
  prices: number[][];
  simulationStatus: HealthCacheStatus;
}

export interface MarginfiAccountTypeDto {
  address: string;
  group: string;
  authority: string;
  balances: BalanceTypeDto[];
  accountFlags: AccountFlags[];
  emissionsDestinationAccount: string;
  healthCache: HealthCacheTypeDto;
}
