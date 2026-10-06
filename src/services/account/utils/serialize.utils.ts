import {
  BalanceType,
  BalanceTypeDto,
  HealthCacheType,
  HealthCacheTypeDto,
  MarginfiAccountType,
  MarginfiAccountTypeDto,
} from "../types";

export function marginfiAccountToDto(marginfiAccount: MarginfiAccountType): MarginfiAccountTypeDto {
  return {
    address: marginfiAccount.address,
    group: marginfiAccount.group,
    authority: marginfiAccount.authority,
    balances: marginfiAccount.balances.map(balanceToDto),
    accountFlags: marginfiAccount.accountFlags,
    healthCache: healthCacheToDto(marginfiAccount.healthCache),
    activeOrders: marginfiAccount.activeOrders,
  };
}

export function balanceToDto(balance: BalanceType): BalanceTypeDto {
  return {
    active: balance.active,
    bankPk: balance.bankPk,
    tag: balance.tag,
    assetShares: balance.assetShares.toString(),
    liabilityShares: balance.liabilityShares.toString(),
    lastUpdate: balance.lastUpdate,
  };
}

export function healthCacheToDto(healthCache: HealthCacheType): HealthCacheTypeDto {
  return {
    assetValue: healthCache.assetValue.toString(),
    liabilityValue: healthCache.liabilityValue.toString(),
    assetValueMaint: healthCache.assetValueMaint.toString(),
    liabilityValueMaint: healthCache.liabilityValueMaint.toString(),
    assetValueEquity: healthCache.assetValueEquity.toString(),
    liabilityValueEquity: healthCache.liabilityValueEquity.toString(),
    timestamp: healthCache.timestamp.toString(),
    flags: healthCache.flags,
    prices: healthCache.prices,
    simulationStatus: healthCache.simulationStatus,
  };
}
