import { BigNumber } from "bignumber.js";
import { describe, expect, it, vi } from "vitest";

import { key } from "../../../helpers/addresses";
import { makeAccount, makeBalance, makeBank, makeOraclePrice } from "../../../helpers/factories";

import {
  BalanceType,
  HealthCacheStatus,
  MarginRequirementType,
  type HealthCacheType,
} from "~/services/account/types";
import {
  computeAssetHealthComponent,
  computeFreeCollateralFromBalances,
  computeFreeCollateralFromCache,
  computeHealthCacheStatus,
  computeHealthComponentsFromBalances,
  computeHealthComponentsFromCache,
  computeLiabilityHealthComponent,
} from "~/services/account/utils/health.utils";
import { BankType, OperationalState, RiskTier } from "~/services/bank/types";
import type { OraclePrice } from "~/services/price";

const weightedBank = () =>
  makeBank({
    mintDecimals: 0,
    config: {
      riskTier: RiskTier.Collateral,
      operationalState: OperationalState.Operational,
      assetWeightInit: new BigNumber(0.8),
      assetWeightMaint: new BigNumber(0.9),
      liabilityWeightInit: new BigNumber(1.25),
      liabilityWeightMaint: new BigNumber(1.1),
      totalAssetValueInitLimit: new BigNumber(0),
    },
  });

// 10 tokens deposited in `collateral` and 5 borrowed from `debt`, both at $10
const collateral = weightedBank();
const debt = weightedBank();
const banksMap = new Map<string, BankType>([collateral, debt].map((b) => [b.address, b]));
const balances = [makeBalance(collateral, "asset", 10), makeBalance(debt, "liability", 5)];
const prices = new Map([
  [collateral.address, makeOraclePrice(10)],
  [debt.address, makeOraclePrice(10)],
]);

const componentsAt = (
  marginRequirement: MarginRequirementType,
  overrides: Partial<Parameters<typeof computeHealthComponentsFromBalances>[0]> = {}
) => {
  const { assets, liabilities } = computeHealthComponentsFromBalances({
    activeBalances: balances,
    marginRequirement,
    banksMap,
    oraclePricesByBank: prices,
    ...overrides,
  });
  return { assets: assets.toNumber(), liabilities: liabilities.toNumber() };
};

describe("computeHealthComponentsFromBalances", () => {
  it("weights assets and liabilities by the requirement's weights", () => {
    expect(componentsAt(MarginRequirementType.Initial)).toEqual({ assets: 80, liabilities: 62.5 });
    expect(componentsAt(MarginRequirementType.Maintenance)).toEqual({
      assets: 90,
      liabilities: 55,
    });
    expect(componentsAt(MarginRequirementType.Equity)).toEqual({ assets: 100, liabilities: 50 });
  });

  it("values assets at the low end and liabilities at the high end of the confidence band", () => {
    const banded = (price: number, spread: number): OraclePrice => {
      const component = {
        price: new BigNumber(price),
        confidence: new BigNumber(spread),
        lowestPrice: new BigNumber(price - spread),
        highestPrice: new BigNumber(price + spread),
      };
      return { priceRealtime: component, priceWeighted: component, timestamp: new BigNumber(0) };
    };
    const oraclePricesByBank = new Map([
      [collateral.address, banded(10, 1)],
      [debt.address, banded(10, 1)],
    ]);

    expect(componentsAt(MarginRequirementType.Equity, { oraclePricesByBank })).toEqual({
      assets: 90,
      liabilities: 55,
    });
  });

  it("only ever raises a bank's asset weights with its emode weights", () => {
    const emode = (init: number, maint: number) =>
      new Map([
        [
          collateral.address,
          { assetWeightInit: new BigNumber(init), assetWeightMaint: new BigNumber(maint) },
        ],
      ]);

    expect(
      componentsAt(MarginRequirementType.Initial, { activeEmodeWeightsByBank: emode(0.9, 0.95) })
        .assets
    ).toBe(90);
    expect(
      componentsAt(MarginRequirementType.Initial, { activeEmodeWeightsByBank: emode(0.5, 0.6) })
        .assets
    ).toBe(80);
  });

  it("leaves out the excluded banks", () => {
    expect(componentsAt(MarginRequirementType.Initial, { excludedBanks: [debt.address] })).toEqual({
      assets: 80,
      liabilities: 0,
    });
  });

  it("fails on a liability without a price and counts an asset without one as 0", () => {
    const unpriced = new Map<string, OraclePrice>();
    expect(() =>
      componentsAt(MarginRequirementType.Initial, { oraclePricesByBank: unpriced })
    ).toThrow(/price/);
    expect(
      componentsAt(MarginRequirementType.Initial, {
        activeBalances: [balances[0]],
        oraclePricesByBank: unpriced,
      }).assets
    ).toBe(0);
  });

  it("fails on a balance whose bank is missing", () => {
    expect(() => componentsAt(MarginRequirementType.Initial, { banksMap: new Map() })).toThrow(
      /not found/
    );
  });
});

describe("computeFreeCollateralFromBalances", () => {
  const freeCollateral = (activeBalances: BalanceType[], clamped?: boolean) =>
    computeFreeCollateralFromBalances({
      activeBalances,
      banksMap,
      oraclePricesByBank: prices,
      clamped,
    }).toNumber();

  it("is the Initial assets minus liabilities", () => {
    expect(freeCollateral(balances)).toBe(17.5);
  });

  it("clamps a shortfall to zero unless asked for the signed value", () => {
    const underwater = [makeBalance(collateral, "asset", 1), makeBalance(debt, "liability", 5)];
    expect(freeCollateral(underwater)).toBe(0);
    expect(freeCollateral(underwater, false)).toBe(-54.5);
  });
});

describe("computeHealthCacheStatus", () => {
  it("computes all three requirement levels", () => {
    const cache = computeHealthCacheStatus({
      activeBalances: balances,
      banksMap,
      oraclePricesByBank: prices,
    });

    expect(cache.simulationStatus).toBe(HealthCacheStatus.COMPUTED);
    expect([cache.assetValue, cache.liabilityValue].map(Number)).toEqual([80, 62.5]);
    expect([cache.assetValueMaint, cache.liabilityValueMaint].map(Number)).toEqual([90, 55]);
    expect([cache.assetValueEquity, cache.liabilityValueEquity].map(Number)).toEqual([100, 50]);
  });
});

describe("computeHealthComponentsFromCache", () => {
  const cached = (healthCache: Partial<HealthCacheType>) => ({
    ...makeAccount([]),
    healthCache: {
      ...computeHealthCacheStatus({
        activeBalances: balances,
        banksMap,
        oraclePricesByBank: prices,
      }),
      ...healthCache,
    },
  });

  it("reads the requirement's values from the account's health cache", () => {
    const { assets, liabilities } = computeHealthComponentsFromCache(
      cached({}),
      MarginRequirementType.Maintenance
    );
    expect([assets, liabilities].map(Number)).toEqual([90, 55]);
    expect(computeFreeCollateralFromCache(cached({})).toNumber()).toBe(17.5);
  });

  it("warns when the cache hasn't been computed", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    computeHealthComponentsFromCache(
      cached({ simulationStatus: HealthCacheStatus.UNSET }),
      MarginRequirementType.Initial
    );
    expect(warn).toHaveBeenCalledOnce();
  });
});

describe("computeAssetHealthComponent", () => {
  it("values only the listed banks' assets", () => {
    const other = weightedBank();

    const assets = computeAssetHealthComponent({
      balances: [...balances, makeBalance(other, "asset", 100)],
      banksMap: new Map([...banksMap, [other.address, other]]),
      oraclePricesByBank: new Map([...prices, [other.address, makeOraclePrice(10)]]),
      assetBanks: [collateral.address],
      marginRequirement: MarginRequirementType.Initial,
    });

    expect(assets.toNumber()).toBe(80);
  });
});

describe("computeLiabilityHealthComponent", () => {
  it("values only the listed banks' liabilities", () => {
    const liabilities = computeLiabilityHealthComponent({
      balances: [...balances, { ...makeBalance(debt, "liability", 5), bankPk: key(250) }],
      banksMap,
      oraclePricesByBank: prices,
      liabilityBanks: [debt.address],
      marginRequirement: MarginRequirementType.Maintenance,
    });

    expect(liabilities.toNumber()).toBe(55);
  });
});
