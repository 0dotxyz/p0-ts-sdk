import { BigNumber } from "bignumber.js";

import { addr } from "./addresses";

import { DEFAULT_ADDRESS, MAX_BALANCES } from "~/constants";
import {
  createEmptyBalance,
  HealthCacheStatus,
  type BalanceType,
  type MarginfiAccountType,
} from "~/services/account";
import { AssetTag, OracleSetup, type BankConfigType, type BankType } from "~/services/bank";
import type { OraclePrice } from "~/services/price";

// A Pyth-priced bank with only the fields the transaction builders read; share values are 1
export function makeBank(
  overrides: Partial<Omit<BankType, "config">> & { config?: Partial<BankConfigType> } = {}
): BankType {
  const oracle = addr();
  const { config, ...fields } = overrides;
  return {
    address: addr(),
    mint: addr(),
    mintDecimals: 6,
    assetShareValue: new BigNumber(1),
    liabilityShareValue: new BigNumber(1),
    group: addr(),
    liquidityVault: addr(),
    oracleKey: oracle,
    premiumTag: 0,
    premiumActive: false,
    premiumActivatedAt: 0,
    ...fields,
    config: {
      oracleSetup: OracleSetup.PythPushOracle,
      assetTag: AssetTag.DEFAULT,
      oracleKeys: [oracle],
      ...config,
    },
  } as unknown as BankType;
}

export function makeBalance(
  bank: BankType,
  side: "asset" | "liability",
  shares: number
): BalanceType {
  return {
    ...createEmptyBalance(bank.address),
    active: true,
    assetShares: new BigNumber(side === "asset" ? shares : 0),
    liabilityShares: new BigNumber(side === "liability" ? shares : 0),
  };
}

// An account holding `active`, its other balance slots empty
export function makeAccount(active: BalanceType[]): MarginfiAccountType {
  const empty = Array.from({ length: MAX_BALANCES - active.length }, () =>
    createEmptyBalance(DEFAULT_ADDRESS)
  );
  return {
    address: addr(),
    group: addr(),
    authority: addr(),
    balances: [...active, ...empty],
    accountFlags: [],
    emissionsDestinationAccount: DEFAULT_ADDRESS,
    healthCache: { simulationStatus: HealthCacheStatus.UNSET },
  } as unknown as MarginfiAccountType;
}

// The same price realtime and time-weighted, with no confidence interval
export function makeOraclePrice(price: number): OraclePrice {
  const component = {
    price: new BigNumber(price),
    confidence: new BigNumber(0),
    lowestPrice: new BigNumber(price),
    highestPrice: new BigNumber(price),
  };
  return { priceRealtime: component, priceWeighted: component, timestamp: new BigNumber(0) };
}
