import { BigNumber } from "bignumber.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { makeOraclePrice } from "../../../helpers/factories";
import { makeDebt, makePremiumBank, NOW, usdc, YEAR } from "../../../helpers/premium";

import {
  BalanceType,
  computeBalancePremium,
  computePremiumBreakdown,
  computePremiumImpact,
  computePremiumRatesByBank,
} from "~/services/account";
import { BankType, RiskTier } from "~/services/bank";
import { PremiumEntry } from "~/services/group";

describe("computeBalancePremium", () => {
  it("accrues simple interest at the stored rate (vb03: 1000 USDC x 1% x 1 year = 10)", () => {
    const b = makePremiumBank();
    const balance = makeDebt({
      bankPk: b.address,
      principal: 1000,
      rate: 0.01,
      lastUpdate: NOW - YEAR,
    });
    expect(computeBalancePremium(balance, b, NOW).toNumber()).toBe(usdc(10).toNumber());
  });

  it("adds the premium already accrued into the balance", () => {
    const b = makePremiumBank();
    const balance = makeDebt({
      bankPk: b.address,
      principal: 1000,
      rate: 0.01,
      outstanding: 6,
      lastUpdate: NOW - YEAR / 2,
    });
    expect(computeBalancePremium(balance, b, NOW).toNumber()).toBe(usdc(11).toNumber());
  });

  it("charges on principal from the liability share value", () => {
    const b = makePremiumBank({ liabilityShareValue: 1.1 });
    const balance = makeDebt({
      bankPk: b.address,
      principal: 1000,
      rate: 0.01,
      lastUpdate: NOW - YEAR,
    });
    expect(computeBalancePremium(balance, b, NOW).toNumber()).toBeCloseTo(usdc(11).toNumber(), 3);
  });

  it("starts accruing at the bank's premium activation, not before", () => {
    const b = makePremiumBank({ activatedAt: NOW - YEAR / 2 });
    const balance = makeDebt({
      bankPk: b.address,
      principal: 1000,
      rate: 0.01,
      lastUpdate: NOW - YEAR,
    });
    expect(computeBalancePremium(balance, b, NOW).toNumber()).toBe(usdc(5).toNumber());
  });

  it("only counts the accrued premium for uninitialized balances and clock skew", () => {
    const b = makePremiumBank();
    const fresh = makeDebt({
      bankPk: b.address,
      principal: 1000,
      rate: 0.5,
      outstanding: 2,
      lastUpdate: 0,
    });
    const ahead = makeDebt({
      bankPk: b.address,
      principal: 1000,
      rate: 0.5,
      outstanding: 2,
      lastUpdate: NOW + 60,
    });
    expect(computeBalancePremium(fresh, b, NOW).toNumber()).toBe(usdc(2).toNumber());
    expect(computeBalancePremium(ahead, b, NOW).toNumber()).toBe(usdc(2).toNumber());
  });

  it("is zero when the bank's premium is off, even with a stale stored premium", () => {
    const b = makePremiumBank({ premiumActive: false });
    const balance = makeDebt({
      bankPk: b.address,
      principal: 1000,
      rate: 0.5,
      outstanding: 3,
      lastUpdate: NOW - YEAR,
    });
    expect(computeBalancePremium(balance, b, NOW).isZero()).toBe(true);
  });

  it("is zero for deposits", () => {
    const b = makePremiumBank();
    const balance: BalanceType = {
      ...makeDebt({
        bankPk: b.address,
        principal: 0,
        rate: 0.5,
        outstanding: 3,
        lastUpdate: NOW - YEAR,
      }),
      assetShares: usdc(1000),
    };
    expect(computeBalancePremium(balance, b, NOW).isZero()).toBe(true);
  });
});

const STABLE = 1;
const SOL = 2;
const VOLATILE = 4;

const entry = (collateralTag: number, liabilityTag: number, rate: number): PremiumEntry => ({
  collateralTag,
  liabilityTag,
  rate: new BigNumber(rate),
});

function taggedBank(
  premiumTag: number,
  opts: {
    premiumActive?: boolean;
    riskTier?: RiskTier;
    assetWeightMaint?: number;
  } = {}
): BankType {
  const b = makePremiumBank({ premiumActive: opts.premiumActive ?? true });
  return {
    ...b,
    premiumTag,
    config: {
      ...b.config,
      riskTier: opts.riskTier ?? RiskTier.Collateral,
      assetWeightMaint: new BigNumber(opts.assetWeightMaint ?? 0.9),
    },
  } as BankType;
}

function deposit(b: BankType, ui: number): BalanceType {
  return {
    active: true,
    bankPk: b.address,
    tag: 0,
    assetShares: usdc(ui),
    liabilityShares: new BigNumber(0),
    premiumRate: new BigNumber(0),
    premiumOutstanding: new BigNumber(0),
    lastUpdate: NOW,
  };
}

function state(banks: BankType[], activeBalances: BalanceType[], premiumEntries: PremiumEntry[]) {
  return {
    activeBalances,
    banksMap: new Map(banks.map((b) => [b.address, b])),
    oraclePricesByBank: new Map(banks.map((b) => [b.address, makeOraclePrice(1)])),
    premiumEntries,
  };
}

describe("computePremiumRatesByBank", () => {
  it("vb02: single tagged collateral pays the pair rate, mixing in untagged halves it, untagged pays 0", () => {
    const usdcBank = taggedBank(STABLE);
    const solBank = taggedBank(SOL);
    const solUntagged = taggedBank(0);
    const banks = [usdcBank, solBank, solUntagged];
    const entries = [entry(SOL, STABLE, 0.01)];
    const rate = (balances: BalanceType[]) =>
      computePremiumRatesByBank(state(banks, balances, entries))
        .get(usdcBank.address)
        ?.toNumber();

    expect(rate([deposit(solBank, 10)])).toBeCloseTo(0.01, 12);
    expect(rate([deposit(solBank, 10), deposit(solUntagged, 10)])).toBeCloseTo(0.005, 12);
    expect(rate([deposit(solUntagged, 10)])).toBe(0);
  });

  it("release notes: USDC 0%, BONK 10%, USDC + BONK 5% when borrowing a STABLE bank", () => {
    const usdt = taggedBank(STABLE);
    const usdcBank = taggedBank(STABLE);
    const bonk = taggedBank(VOLATILE);
    const banks = [usdt, usdcBank, bonk];
    const entries = [entry(VOLATILE, STABLE, 0.1)];
    const rate = (balances: BalanceType[]) =>
      computePremiumRatesByBank(state(banks, balances, entries))
        .get(usdt.address)
        ?.toNumber();

    expect(rate([deposit(usdcBank, 10)])).toBe(0);
    expect(rate([deposit(bonk, 10)])).toBeCloseTo(0.1, 12);
    expect(rate([deposit(usdcBank, 10), deposit(bonk, 10)])).toBeCloseTo(0.05, 12);
  });

  it("vb05: 8x8 table with equal collateral averages each liability's column", () => {
    const N = 8;
    const step = 0.0005;
    const collateralBanks = Array.from({ length: N }, (_, i) => taggedBank(1000 + i));
    const liabilityBanks = Array.from({ length: N }, (_, j) => taggedBank(2000 + j));
    const entries = collateralBanks.flatMap((_, i) =>
      liabilityBanks.map((__, j) => entry(1000 + i, 2000 + j, (i * N + j + 1) * step))
    );
    const rates = computePremiumRatesByBank(
      state(
        [...collateralBanks, ...liabilityBanks],
        collateralBanks.map((b) => deposit(b, 1000)),
        entries
      )
    );

    liabilityBanks.forEach((b, j) => {
      expect(rates.get(b.address)?.toNumber()).toBeCloseTo(step * (j + 1 + (N * (N - 1)) / 2), 12);
    });
  });

  it("leaves out isolated and zero-maintenance-weight collateral and omits premium-inactive banks", () => {
    const usdcBank = taggedBank(STABLE);
    const inactive = taggedBank(STABLE, { premiumActive: false });
    const bonk = taggedBank(VOLATILE);
    const isolated = taggedBank(0, { riskTier: RiskTier.Isolated });
    const zeroWeight = taggedBank(0, { assetWeightMaint: 0 });
    const banks = [usdcBank, inactive, bonk, isolated, zeroWeight];
    const rates = computePremiumRatesByBank(
      state(
        banks,
        [deposit(bonk, 10), deposit(isolated, 1000), deposit(zeroWeight, 1000)],
        [entry(VOLATILE, STABLE, 0.5)]
      )
    );

    expect(rates.get(usdcBank.address)?.toNumber()).toBeCloseTo(0.5, 12);
    expect(rates.has(inactive.address)).toBe(false);
  });

  it("values integration collateral through its share multiplier", () => {
    const usdcBank = taggedBank(STABLE);
    const kaminoSol = taggedBank(SOL);
    const wif = taggedBank(VOLATILE);
    const banks = [usdcBank, kaminoSol, wif];
    const rates = computePremiumRatesByBank({
      ...state(
        banks,
        [deposit(kaminoSol, 10), deposit(wif, 20)],
        [entry(SOL, STABLE, 0.05), entry(VOLATILE, STABLE, 0.5)]
      ),
      assetShareValueMultiplierByBank: new Map([[kaminoSol.address, new BigNumber(2)]]),
    });

    // 20 USD of Kamino SOL at 5% and 20 USD of WIF at 50%
    expect(rates.get(usdcBank.address)?.toNumber()).toBeCloseTo(0.275, 12);
  });
});

describe("computePremiumBreakdown", () => {
  const usdt = taggedBank(STABLE);
  const usdcBank = taggedBank(STABLE);
  const bonk = taggedBank(VOLATILE);
  const isolated = taggedBank(VOLATILE, { riskTier: RiskTier.Isolated });
  const inactive = taggedBank(STABLE, { premiumActive: false });
  const banks = [usdt, usdcBank, bonk, isolated, inactive];
  const params = state(
    banks,
    [deposit(usdcBank, 10), deposit(bonk, 10), deposit(isolated, 100)],
    [entry(VOLATILE, STABLE, 0.1)]
  );

  it("gives one row per counted collateral, summing to the rate (release notes: USDC + BONK = 5%)", () => {
    const rows = computePremiumBreakdown(params, usdt.address);
    const row = (b: BankType) => rows.find((r) => r.bank === b.address);

    expect(rows).toHaveLength(2);
    expect(row(usdcBank)).toMatchObject({ tag: STABLE });
    expect(row(usdcBank)?.pairRate.toNumber()).toBe(0);
    expect(row(usdcBank)?.contributionApr.toNumber()).toBe(0);
    expect(row(bonk)?.usd.toNumber()).toBeCloseTo(10, 9);
    expect(row(bonk)?.pairRate.toNumber()).toBeCloseTo(0.1, 12);
    expect(row(bonk)?.contributionApr.toNumber()).toBeCloseTo(0.05, 12);

    const total = rows.reduce((sum, r) => sum + r.contributionApr.toNumber(), 0);
    expect(total).toBeCloseTo(
      computePremiumRatesByBank(params).get(usdt.address)?.toNumber() ?? NaN,
      12
    );
  });

  it("is empty for a bank without premium", () => {
    expect(computePremiumBreakdown(params, inactive.address)).toEqual([]);
  });
});

describe("computePremiumImpact", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW * 1000);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const usdcBank = taggedBank(STABLE);
  const usdtBank = taggedBank(STABLE);
  const solBank = taggedBank(SOL);
  const wif = taggedBank(VOLATILE);
  const banks = [usdcBank, usdtBank, solBank, wif];
  const entries = [entry(VOLATILE, STABLE, 0.5), entry(SOL, STABLE, 0.05)];
  const usdcDebt = makeDebt({
    bankPk: usdcBank.address,
    principal: 10_000,
    rate: 0.5,
    lastUpdate: NOW,
  });
  const key = (b: BankType) => b.address;

  it("a stable deposit lowers the rate of existing debt, and the SDK pulse applies it now", () => {
    const impact = computePremiumImpact({
      ...state(banks, [deposit(wif, 10_000), usdcDebt], entries),
      actions: [{ type: "deposit", bank: usdtBank.address, amount: 10_000 }],
    });

    expect(impact.refreshes).toBe(true);
    expect(impact.liabilities.get(key(usdcBank))?.before?.toNumber()).toBe(0.5);
    expect(
      impact.liabilities
        .get(key(usdcBank))
        ?.breakdown.map((row) => [row.bank, row.contributionApr.toNumber()])
    ).toEqual([
      [key(wif), 0.25],
      [key(usdtBank), 0],
    ]);
    expect(impact.liabilities.get(key(usdcBank))?.after.toNumber()).toBeCloseTo(0.25, 12);
    expect(impact.annualPremiumUsd.before.toNumber()).toBeCloseTo(5000, 6);
    expect(impact.annualPremiumUsd.after.toNumber()).toBeCloseTo(2500, 6);
  });

  it("a withdrawal raises it", () => {
    const impact = computePremiumImpact({
      ...state(banks, [deposit(wif, 10_000), deposit(usdtBank, 10_000), usdcDebt], entries),
      actions: [{ type: "withdraw", bank: usdtBank.address, amount: 5_000 }],
    });

    // 10k WIF at 50% and 5k USDT at 0%
    expect(impact.liabilities.get(key(usdcBank))?.after.toNumber()).toBeCloseTo(1 / 3, 12);
  });

  it("a new borrow has no stored rate and pays the current-mix rate", () => {
    const impact = computePremiumImpact({
      ...state(banks, [deposit(solBank, 1_000)], entries),
      actions: [{ type: "borrow", bank: usdtBank.address, amount: 100 }],
    });

    expect(impact.refreshes).toBe(true);
    expect(impact.liabilities.get(key(usdtBank))?.before).toBeUndefined();
    expect(impact.liabilities.get(key(usdtBank))?.after.toNumber()).toBeCloseTo(0.05, 12);
    expect(impact.annualPremiumUsd.after.toNumber()).toBeCloseTo(5, 9);
  });

  it("repaying the whole debt removes it, and a deposit without debt refreshes nothing", () => {
    const repaid = computePremiumImpact({
      ...state(banks, [deposit(wif, 10_000), usdcDebt], entries),
      actions: [{ type: "repay", bank: usdcBank.address, amount: 10_000 }],
    });
    expect(repaid.liabilities.size).toBe(0);
    expect(repaid.annualPremiumUsd.after.isZero()).toBe(true);

    const noDebt = computePremiumImpact({
      ...state(banks, [deposit(wif, 10_000)], entries),
      actions: [{ type: "deposit", bank: usdtBank.address, amount: 1 }],
    });
    expect(noDebt.refreshes).toBe(false);
    expect(noDebt.liabilities.size).toBe(0);
  });

  it("a partial repay pays premium first, so only the rest lowers principal", () => {
    const owing = makeDebt({
      bankPk: usdcBank.address,
      principal: 10_000,
      rate: 0.5,
      outstanding: 100,
      lastUpdate: NOW,
    });
    const impact = computePremiumImpact({
      ...state(banks, [deposit(wif, 10_000), owing], entries),
      actions: [{ type: "repay", bank: usdcBank.address, amount: 1_100 }],
    });

    expect(impact.annualPremiumUsd.after.toNumber()).toBeCloseTo(9_000 * 0.5, 6);
  });

  it("previews a loop's end state from all its legs", () => {
    const impact = computePremiumImpact({
      ...state(banks, [deposit(solBank, 1_000)], entries),
      actions: [
        { type: "deposit", bank: wif.address, amount: 1_000 },
        { type: "borrow", bank: usdcBank.address, amount: 500 },
      ],
    });

    expect(impact.liabilities.get(key(usdcBank))?.after.toNumber()).toBeCloseTo(0.275, 12);
  });
});
