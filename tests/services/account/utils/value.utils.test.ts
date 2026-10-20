import type { Address } from "@solana/kit";
import { BigNumber } from "bignumber.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { key } from "../../../helpers/addresses";
import { makeOraclePrice } from "../../../helpers/factories";
import { makeDebt, makePremiumBank, NOW, usdc, YEAR } from "../../../helpers/premium";

import { BalanceType, MarginRequirementType } from "~/services/account/types";
import {
  computeOrderPairNetValue,
  computeQuantity,
  getBalanceUsdValueWithPriceBias,
} from "~/services/account/utils/value.utils";
import { AssetTag, BankType, OperationalState, RiskTier } from "~/services/bank";
import { OraclePrice } from "~/services/price";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW * 1000);
});
afterEach(() => {
  vi.useRealTimers();
});

describe("computeQuantity", () => {
  it("counts premium in the debt quantity", () => {
    const b = makePremiumBank();
    const balance = makeDebt({
      bankPk: b.address,
      principal: 1000,
      rate: 0.01,
      lastUpdate: NOW - YEAR,
    });
    expect(computeQuantity(balance, b).liabilities.toNumber()).toBe(usdc(1010).toNumber());
  });
});

describe("getBalanceUsdValueWithPriceBias", () => {
  it("prices premium like principal in health: high-bias price x liability weight", () => {
    const b = makePremiumBank();
    const balance = makeDebt({
      bankPk: b.address,
      principal: 1000,
      rate: 0.01,
      lastUpdate: NOW - YEAR,
    });
    const { liabilities } = getBalanceUsdValueWithPriceBias({
      balance,
      bank: b,
      oraclePrice: makeOraclePrice(1, 0.01),
      marginRequirement: MarginRequirementType.Initial,
    });
    // (1000 + 10) x 1.01 x 1.25
    expect(liabilities.toNumber()).toBeCloseTo(1275.125, 6);
  });
});

describe("computeOrderPairNetValue", () => {
  const bankA = key(1);
  const bankB = key(2);
  const balance = (
    bankPk: Address,
    tag: number,
    side: { assets?: number; liabilities?: number }
  ): BalanceType => ({
    active: true,
    bankPk,
    tag,
    assetShares: new BigNumber(side.assets ?? 0),
    liabilityShares: new BigNumber(side.liabilities ?? 0),
    premiumRate: new BigNumber(0),
    premiumOutstanding: new BigNumber(0),
    lastUpdate: 0,
  });
  const bank = (address: Address, riskTier = RiskTier.Collateral): BankType =>
    ({
      address,
      mint: address,
      mintDecimals: 0,
      assetShareValue: new BigNumber(1),
      liabilityShareValue: new BigNumber(1),
      config: {
        riskTier,
        operationalState: OperationalState.Operational,
        assetTag: AssetTag.DEFAULT,
        assetWeightInit: new BigNumber(0.8),
        assetWeightMaint: new BigNumber(0.9),
        liabilityWeightInit: new BigNumber(1.25),
        liabilityWeightMaint: new BigNumber(1.1),
      },
    }) as unknown as BankType;

  // Spot 100 but EMA 90 with a band of 88..92, so only the EMA band can produce the expected values.
  const oraclePrice = (): OraclePrice =>
    ({
      priceRealtime: {
        price: new BigNumber(100),
        confidence: new BigNumber(0),
        lowestPrice: new BigNumber(100),
        highestPrice: new BigNumber(100),
      },
      priceWeighted: {
        price: new BigNumber(90),
        confidence: new BigNumber(2),
        lowestPrice: new BigNumber(88),
        highestPrice: new BigNumber(92),
      },
      timestamp: new BigNumber(0),
    }) as OraclePrice;

  it("values the pair at the EMA band like the program trigger", () => {
    const value = computeOrderPairNetValue({
      collateral: {
        balance: balance(bankA, 3, { assets: 10 }),
        bank: bank(bankA),
        oraclePrice: oraclePrice(),
      },
      debt: {
        balance: balance(bankB, 4, { liabilities: 5 }),
        bank: bank(bankB),
        oraclePrice: oraclePrice(),
      },
    });
    expect(value.collateralUsd.toNumber()).toBe(880);
    expect(value.debtUsd.toNumber()).toBe(460);
    expect(value.netUsd.toNumber()).toBe(420);
  });

  it("counts isolated-tier collateral as zero", () => {
    const value = computeOrderPairNetValue({
      collateral: {
        balance: balance(bankA, 3, { assets: 10 }),
        bank: bank(bankA, RiskTier.Isolated),
        oraclePrice: oraclePrice(),
      },
      debt: {
        balance: balance(bankB, 4, { liabilities: 5 }),
        bank: bank(bankB),
        oraclePrice: oraclePrice(),
      },
    });
    expect(value.collateralUsd.toNumber()).toBe(0);
    expect(value.netUsd.toNumber()).toBe(-460);
  });
});
