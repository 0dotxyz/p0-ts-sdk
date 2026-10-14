import type { Address } from "@solana/kit";
import { BigNumber } from "bignumber.js";

import { addr } from "./addresses";

import type { BalanceType } from "~/services/account";
import { OperationalState, RiskTier, type BankType } from "~/services/bank";

export const YEAR = 31_536_000;
// The clock the premium math runs at; set it with vi.setSystemTime(NOW * 1000)
export const NOW = 1_800_000_000;
export const usdc = (n: number) => new BigNumber(n).times(1e6);

// A 6-decimal bank charging the variable borrow premium (tag 1), with the totals, weights and
// interest-rate config the value and rate math reads
export function makePremiumBank(
  opts: { premiumActive?: boolean; activatedAt?: number; liabilityShareValue?: number } = {}
): BankType {
  return {
    address: addr(),
    mint: addr(),
    mintDecimals: 6,
    assetShareValue: new BigNumber(1),
    liabilityShareValue: new BigNumber(opts.liabilityShareValue ?? 1),
    totalAssetShares: usdc(1_000_000),
    totalLiabilityShares: usdc(500_000),
    lastUpdate: NOW,
    premiumTag: 1,
    premiumActive: opts.premiumActive ?? true,
    premiumActivatedAt: opts.activatedAt ?? 0,
    config: {
      riskTier: RiskTier.Collateral,
      operationalState: OperationalState.Operational,
      assetWeightInit: new BigNumber(0.8),
      assetWeightMaint: new BigNumber(0.9),
      liabilityWeightInit: new BigNumber(1.25),
      liabilityWeightMaint: new BigNumber(1.1),
      totalAssetValueInitLimit: new BigNumber(0),
      interestRateConfig: {
        placeholder0: new BigNumber(0.8),
        placeholder1: new BigNumber(0.1),
        placeholder2: new BigNumber(1),
        insuranceFeeFixedApr: new BigNumber(0),
        insuranceIrFee: new BigNumber(0),
        protocolFixedFeeApr: new BigNumber(0),
        protocolIrFee: new BigNumber(0),
        protocolOriginationFee: new BigNumber(0),
        zeroUtilRate: 0,
        hundredUtilRate: 0,
        points: [],
        curveType: 0,
      },
    },
  } as unknown as BankType;
}

// A debt of `principal` UI units at the stored premium `rate`, with `outstanding` UI units of
// premium accrued up to `lastUpdate`
export function makeDebt(opts: {
  bankPk: Address;
  principal: number;
  rate: number;
  outstanding?: number;
  lastUpdate: number;
}): BalanceType {
  return {
    active: true,
    bankPk: opts.bankPk,
    tag: 0,
    assetShares: new BigNumber(0),
    liabilityShares: usdc(opts.principal),
    premiumRate: new BigNumber(opts.rate),
    premiumOutstanding: usdc(opts.outstanding ?? 0),
    lastUpdate: opts.lastUpdate,
  };
}
