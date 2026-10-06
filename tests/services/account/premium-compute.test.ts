import { createNoopSigner, getAddressDecoder, type Address } from "@solana/kit";
import { TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { BigNumber } from "bignumber.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import instructions from "~/instructions";
import {
  BalanceType,
  computeBalancePremium,
  computeNetApy,
  computePremiumBreakdown,
  computePremiumImpact,
  computePremiumRatesByBank,
  computeProjectedActiveBalancesNoCpi,
  computeQuantity,
  getBalanceUsdValueWithPriceBias,
  HealthCacheStatus,
  MarginfiAccountType,
  MarginRequirementType,
} from "~/services/account";
import { BankType, OperationalState, RiskTier } from "~/services/bank";
import { PremiumEntry } from "~/services/group";
import { OraclePrice } from "~/services/price";

let addressCount = 0;
const uniqueAddress = (): Address => {
  const bytes = new Uint8Array(32);
  new DataView(bytes.buffer).setUint32(0, ++addressCount);
  return getAddressDecoder().decode(bytes);
};
const PROGRAM = uniqueAddress();

const YEAR = 31_536_000;
const NOW = 1_800_000_000;
const usdc = (n: number) => new BigNumber(n).times(1e6);

function bank(
  opts: { premiumActive?: boolean; activatedAt?: number; liabilityShareValue?: number } = {}
): BankType {
  return {
    address: uniqueAddress(),
    mint: uniqueAddress(),
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

function debt(opts: {
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

function oraclePrice(price: number, confidence = 0): OraclePrice {
  const p = {
    price: new BigNumber(price),
    confidence: new BigNumber(confidence),
    lowestPrice: new BigNumber(price - confidence),
    highestPrice: new BigNumber(price + confidence),
  };
  return { priceRealtime: p, priceWeighted: p, timestamp: new BigNumber(0) } as OraclePrice;
}

describe("computeBalancePremium", () => {
  it("accrues simple interest at the stored rate (vb03: 1000 USDC x 1% x 1 year = 10)", () => {
    const b = bank();
    const balance = debt({
      bankPk: b.address,
      principal: 1000,
      rate: 0.01,
      lastUpdate: NOW - YEAR,
    });
    expect(computeBalancePremium(balance, b, NOW).toNumber()).toBe(usdc(10).toNumber());
  });

  it("adds the premium already accrued into the balance", () => {
    const b = bank();
    const balance = debt({
      bankPk: b.address,
      principal: 1000,
      rate: 0.01,
      outstanding: 6,
      lastUpdate: NOW - YEAR / 2,
    });
    expect(computeBalancePremium(balance, b, NOW).toNumber()).toBe(usdc(11).toNumber());
  });

  it("charges on principal from the liability share value", () => {
    const b = bank({ liabilityShareValue: 1.1 });
    const balance = debt({
      bankPk: b.address,
      principal: 1000,
      rate: 0.01,
      lastUpdate: NOW - YEAR,
    });
    expect(computeBalancePremium(balance, b, NOW).toNumber()).toBeCloseTo(usdc(11).toNumber(), 3);
  });

  it("starts accruing at the bank's premium activation, not before", () => {
    const b = bank({ activatedAt: NOW - YEAR / 2 });
    const balance = debt({
      bankPk: b.address,
      principal: 1000,
      rate: 0.01,
      lastUpdate: NOW - YEAR,
    });
    expect(computeBalancePremium(balance, b, NOW).toNumber()).toBe(usdc(5).toNumber());
  });

  it("only counts the accrued premium for uninitialized balances and clock skew", () => {
    const b = bank();
    const fresh = debt({
      bankPk: b.address,
      principal: 1000,
      rate: 0.5,
      outstanding: 2,
      lastUpdate: 0,
    });
    const ahead = debt({
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
    const b = bank({ premiumActive: false });
    const balance = debt({
      bankPk: b.address,
      principal: 1000,
      rate: 0.5,
      outstanding: 3,
      lastUpdate: NOW - YEAR,
    });
    expect(computeBalancePremium(balance, b, NOW).isZero()).toBe(true);
  });

  it("is zero for deposits", () => {
    const b = bank();
    const balance: BalanceType = {
      ...debt({
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

describe("premium in debt, health and net APY", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW * 1000);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("counts premium in the debt quantity", () => {
    const b = bank();
    const balance = debt({
      bankPk: b.address,
      principal: 1000,
      rate: 0.01,
      lastUpdate: NOW - YEAR,
    });
    expect(computeQuantity(balance, b).liabilities.toNumber()).toBe(usdc(1010).toNumber());
  });

  it("prices premium like principal in health: high-bias price x liability weight", () => {
    const b = bank();
    const balance = debt({
      bankPk: b.address,
      principal: 1000,
      rate: 0.01,
      lastUpdate: NOW - YEAR,
    });
    const { liabilities } = getBalanceUsdValueWithPriceBias({
      balance,
      bank: b,
      oraclePrice: oraclePrice(1, 0.01),
      marginRequirement: MarginRequirementType.Initial,
    });
    // (1000 + 10) x 1.01 x 1.25
    expect(liabilities.toNumber()).toBeCloseTo(1275.125, 6);
  });

  it("adds the stored premium rate to the borrow rate in net APY", () => {
    const b = bank();
    const balance = debt({ bankPk: b.address, principal: 1000, rate: 0.05, lastUpdate: NOW });
    const marginfiAccount = {
      healthCache: {
        assetValueEquity: new BigNumber(2000),
        liabilityValueEquity: new BigNumber(1000),
        simulationStatus: HealthCacheStatus.COMPUTED,
      },
    } as unknown as MarginfiAccountType;
    const params = {
      marginfiAccount,
      activeBalances: [balance],
      banksMap: new Map([[b.address, b]]),
      oraclePricesByBank: new Map([[b.address, oraclePrice(1)]]),
    };

    const withPremium = computeNetApy(params);
    const withoutPremium = computeNetApy({
      ...params,
      banksMap: new Map([[b.address, { ...b, premiumActive: false }]]),
    });

    // 1000 USD of debt over 1000 USD of equity pays 5% more APR with the premium
    expect(Math.log1p(withoutPremium) - Math.log1p(withPremium)).toBeGreaterThan(0.049);
  });
});

describe("repay projection", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW * 1000);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  async function project(balance: BalanceType, b: BankType, amount: number, repayAll = false) {
    const account = {
      address: uniqueAddress(),
      balances: [balance],
    } as unknown as MarginfiAccountType;
    const ix = await instructions.makeRepayIx(PROGRAM, {
      group: uniqueAddress(),
      marginfiAccount: account.address,
      authority: createNoopSigner(uniqueAddress()),
      signerTokenAccount: uniqueAddress(),
      bank: b.address,
      liquidityVault: uniqueAddress(),
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
      mint: b.mint,
      amount: BigInt(usdc(amount).toFixed()),
      repayAll,
    });
    return computeProjectedActiveBalancesNoCpi({
      account,
      instructions: [ix],
      programAddress: PROGRAM,
      banksMap: new Map([[b.address, b]]),
      assetShareValueMultiplierByBank: new Map(),
    }).projectedBalances[0];
  }

  it("settles premium before principal (vb03: repay 4 of 10 premium, shares unchanged)", async () => {
    const b = bank();
    const balance = debt({
      bankPk: b.address,
      principal: 1000,
      rate: 0.01,
      lastUpdate: NOW - YEAR,
    });
    const projected = await project(balance, b, 4);
    expect(projected.liabilityShares.toNumber()).toBe(usdc(1000).toNumber());
    expect(projected.premiumOutstanding.toNumber()).toBe(usdc(6).toNumber());
    expect(computeBalancePremium(projected, b, NOW).toNumber()).toBe(usdc(6).toNumber());
  });

  it("repays principal with whatever exceeds the premium", async () => {
    const b = bank();
    const balance = debt({
      bankPk: b.address,
      principal: 1000,
      rate: 0.01,
      lastUpdate: NOW - YEAR,
    });
    const projected = await project(balance, b, 110);
    expect(projected.premiumOutstanding.isZero()).toBe(true);
    expect(projected.liabilityShares.toNumber()).toBe(usdc(900).toNumber());
  });

  it("clears the premium on repay-all", async () => {
    const b = bank();
    const balance = debt({
      bankPk: b.address,
      principal: 1000,
      rate: 0.01,
      lastUpdate: NOW - YEAR,
    });
    const projected = await project(balance, b, 0, true);
    expect(projected.active).toBe(false);
    expect(projected.premiumOutstanding.isZero()).toBe(true);
    expect(projected.premiumRate.isZero()).toBe(true);
  });
});

// ----------------------------------------------------------------------------
// Rates and impacts
// ----------------------------------------------------------------------------

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
  const b = bank({ premiumActive: opts.premiumActive ?? true });
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
    oraclePricesByBank: new Map(banks.map((b) => [b.address, oraclePrice(1)])),
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
  const usdcDebt = debt({
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
    const owing = debt({
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
