import { address, type Address } from "@solana/kit";
import BigNumber from "bignumber.js";

import {
  MarginfiAccountRaw,
  BalanceRaw,
  BalanceType,
  AccountFlags,
  HealthCacheFlags,
  MarginfiAccountTypeDto,
  MarginfiAccountType,
  BalanceTypeDto,
  HealthCacheTypeDto,
  HealthCacheType,
  HealthCacheRaw,
  HealthCacheStatus,
} from "../types";

import { toBigNumber, wrappedI80F48toBigNumber } from "~/utils";

export function parseBalanceRaw(balanceRaw: BalanceRaw): BalanceType {
  const active = balanceRaw.active === 1;
  const bankPk = balanceRaw.bankPk;
  const assetShares = wrappedI80F48toBigNumber(balanceRaw.assetShares);
  const liabilityShares = wrappedI80F48toBigNumber(balanceRaw.liabilityShares);
  const emissionsOutstanding = wrappedI80F48toBigNumber(balanceRaw.emissionsOutstanding);
  const lastUpdate = Number(balanceRaw.lastUpdate);

  return {
    active,
    bankPk,
    assetShares,
    liabilityShares,
    emissionsOutstanding,
    lastUpdate,
  };
}

export function parseHealthCacheRaw(healthCacheRaw: HealthCacheRaw): HealthCacheType {
  const assetValue = wrappedI80F48toBigNumber(healthCacheRaw.assetValue);
  const liabilityValue = wrappedI80F48toBigNumber(healthCacheRaw.liabilityValue);
  const assetValueMaint = wrappedI80F48toBigNumber(healthCacheRaw.assetValueMaint);
  const liabilityValueMaint = wrappedI80F48toBigNumber(healthCacheRaw.liabilityValueMaint);
  const assetValueEquity = wrappedI80F48toBigNumber(healthCacheRaw.assetValueEquity);
  const liabilityValueEquity = wrappedI80F48toBigNumber(healthCacheRaw.liabilityValueEquity);
  const timestamp = toBigNumber(healthCacheRaw.timestamp);
  const flags = getActiveHealthCacheFlags(healthCacheRaw.flags);
  const prices = healthCacheRaw.prices.map((price) => Array.from(price));
  const simulationStatus = HealthCacheStatus.UNSET;

  const healthCache: HealthCacheType = {
    assetValue,
    liabilityValue,
    assetValueMaint,
    liabilityValueMaint,
    assetValueEquity,
    liabilityValueEquity,
    timestamp,
    flags,
    prices,
    simulationStatus,
  };
  return healthCache;
}

export function parseMarginfiAccountRaw(
  marginfiAccountPk: Address,
  accountData: MarginfiAccountRaw
): MarginfiAccountType {
  const address = marginfiAccountPk;
  const group = accountData.group;
  const authority = accountData.authority;
  const balances = accountData.lendingAccount.balances.map(parseBalanceRaw);
  const accountFlags = getActiveAccountFlags(accountData.accountFlags);
  const emissionsDestinationAccount = accountData.emissionsDestinationAccount;
  const healthCache = parseHealthCacheRaw(accountData.healthCache);

  return {
    address,
    group,
    authority,
    balances,
    accountFlags,
    emissionsDestinationAccount,
    healthCache,
  };
}

/**
 * Get all active account flags as an array of flag names
 */
export function getActiveAccountFlags(flags: bigint): AccountFlags[] {
  const activeFlags: AccountFlags[] = [];

  Object.keys(AccountFlags)
    .filter((key) => isNaN(Number(key))) // Only get the string keys (not the reverse mapping)
    .forEach((key) => {
      const flag = AccountFlags[key as keyof typeof AccountFlags];
      if (typeof flag === "number" && hasAccountFlag(flags, flag)) {
        activeFlags.push(flag);
      }
    });

  return activeFlags;
}

/**
 * Check if an account flag is set
 */
export function hasAccountFlag(flags: bigint, flag: number): boolean {
  return (flags & BigInt(flag)) !== 0n;
}

/**
 * Convert on-chain health cache flags to an array of HealthCacheFlags enum values
 *
 * According to the IDL, health cache flags are defined as:
 * - HEALTHY = 1 (bit 0) - If set, the account cannot be liquidated
 * - ENGINE_STATUS_OK = 2 (bit 1) - If set, the engine did not error during health calculation
 * - ORACLE_OK = 4 (bit 2) - If set, the engine did not encounter oracle issues
 */
export function getActiveHealthCacheFlags(flags: number): HealthCacheFlags[] {
  const activeFlags: HealthCacheFlags[] = [];

  // Check each flag bit
  if (hasHealthCacheFlag(flags, HealthCacheFlags.HEALTHY)) {
    activeFlags.push(HealthCacheFlags.HEALTHY);
  }

  if (hasHealthCacheFlag(flags, HealthCacheFlags.ENGINE_STATUS_OK)) {
    activeFlags.push(HealthCacheFlags.ENGINE_STATUS_OK);
  }

  if (hasHealthCacheFlag(flags, HealthCacheFlags.ORACLE_OK)) {
    activeFlags.push(HealthCacheFlags.ORACLE_OK);
  }

  return activeFlags;
}

/**
 * Check if a health cache flag is set
 */
export function hasHealthCacheFlag(flags: number, flag: HealthCacheFlags): boolean {
  return (flags & flag) !== 0;
}

/**
 * Convert numeric health cache flags to a human-readable status message
 */
export function getHealthCacheStatusDescription(flags: number): string {
  const activeFlags = getActiveHealthCacheFlags(flags);

  // Check for critical conditions first
  if (!activeFlags.includes(HealthCacheFlags.HEALTHY)) {
    return "UNHEALTHY: Account is eligible for liquidation";
  }

  if (!activeFlags.includes(HealthCacheFlags.ENGINE_STATUS_OK)) {
    return "ERROR: Risk engine encountered an error during health calculation";
  }

  if (!activeFlags.includes(HealthCacheFlags.ORACLE_OK)) {
    return "WARNING: Oracle price data may be stale or invalid";
  }

  // All good
  if (activeFlags.length === 3) {
    return "HEALTHY: Account is in good standing";
  }

  // Default case (shouldn't happen often)
  return `Status flags: ${activeFlags.join(", ")}`;
}

export function dtoToMarginfiAccount(
  marginfiAccountDto: MarginfiAccountTypeDto
): MarginfiAccountType {
  return {
    address: address(marginfiAccountDto.address),
    group: address(marginfiAccountDto.group),
    authority: address(marginfiAccountDto.authority),
    balances: marginfiAccountDto.balances.map(dtoToBalance),
    accountFlags: marginfiAccountDto.accountFlags,
    emissionsDestinationAccount: address(marginfiAccountDto.emissionsDestinationAccount),
    healthCache: dtoToHealthCache(marginfiAccountDto.healthCache),
  };
}

export function dtoToBalance(balanceDto: BalanceTypeDto): BalanceType {
  return {
    active: balanceDto.active,
    bankPk: address(balanceDto.bankPk),
    assetShares: new BigNumber(balanceDto.assetShares),
    liabilityShares: new BigNumber(balanceDto.liabilityShares),
    emissionsOutstanding: new BigNumber(balanceDto.emissionsOutstanding),
    lastUpdate: balanceDto.lastUpdate,
  };
}

export function dtoToHealthCache(healthCacheDto: HealthCacheTypeDto): HealthCacheType {
  return {
    assetValue: new BigNumber(healthCacheDto.assetValue),
    liabilityValue: new BigNumber(healthCacheDto.liabilityValue),
    assetValueMaint: new BigNumber(healthCacheDto.assetValueMaint),
    liabilityValueMaint: new BigNumber(healthCacheDto.liabilityValueMaint),
    assetValueEquity: new BigNumber(healthCacheDto.assetValueEquity),
    liabilityValueEquity: new BigNumber(healthCacheDto.liabilityValueEquity),
    timestamp: new BigNumber(healthCacheDto.timestamp),
    flags: healthCacheDto.flags,
    prices: healthCacheDto.prices,
    simulationStatus: healthCacheDto.simulationStatus,
  };
}
