import { describe, it, expect } from "vitest";
import { Keypair, PublicKey } from "@solana/web3.js";
import BigNumber from "bignumber.js";

import {
  computeMaxBorrowForBank,
  computeMaxDepositForBank,
  computeMaxWithdrawForBank,
  HealthCacheStatus,
  MarginfiAccountType,
} from "~/services/account";
import {
  AssetTag,
  BankType,
  computeBankDepositCapRemaining,
  computeRemainingCapacity,
  EmodeImpactStatus,
  OperationalState,
  RiskTier,
  U64_MAX,
} from "~/services/bank";
import { OraclePrice } from "~/services/price";

// ----------------------------------------------------------------------------
// Fixtures
// ----------------------------------------------------------------------------

const DECIMALS = 6;
const ui = (n: number) => new BigNumber(n).times(10 ** DECIMALS);

function bank(opts: {
  address?: PublicKey;
  totalDeposits: number; // UI
  totalBorrows: number; // UI
  depositLimit: number; // UI
  borrowLimit: number; // UI
  /** hourly net-outflow cap in UI units with `used` already flowed out this window */
  rateLimit?: { max: number; used: number };
  originationFee?: number;
  assetTag?: AssetTag;
  /** raw native override for depositLimit (e.g. U64_MAX sentinel) */
  depositLimitRaw?: BigNumber;
  borrowLimitRaw?: BigNumber;
  lastUpdate?: number;
}): BankType {
  const rate = (n: number) => new BigNumber(n);
  return {
    address: opts.address ?? Keypair.generate().publicKey,
    mint: Keypair.generate().publicKey,
    mintDecimals: DECIMALS,
    assetShareValue: new BigNumber(1),
    liabilityShareValue: new BigNumber(1),
    totalAssetShares: ui(opts.totalDeposits),
    totalLiabilityShares: ui(opts.totalBorrows),
    lastUpdate: opts.lastUpdate ?? Math.floor(Date.now() / 1000), // no accrued-interest buffer
    rateLimiter: opts.rateLimit
      ? {
          hourly: {
            maxOutflow: ui(opts.rateLimit.max),
            windowDuration: 3600,
            windowStart: Math.floor(Date.now() / 1000) - 60,
            prevWindowOutflow: new BigNumber(0),
            curWindowOutflow: ui(opts.rateLimit.used),
          },
          daily: {
            maxOutflow: new BigNumber(0),
            windowDuration: 86400,
            windowStart: 0,
            prevWindowOutflow: new BigNumber(0),
            curWindowOutflow: new BigNumber(0),
          },
        }
      : undefined,
    config: {
      riskTier: RiskTier.Collateral,
      operationalState: OperationalState.Operational,
      assetTag: opts.assetTag ?? AssetTag.DEFAULT,
      assetWeightInit: new BigNumber(0.8),
      assetWeightMaint: new BigNumber(0.9),
      liabilityWeightInit: new BigNumber(1.25),
      liabilityWeightMaint: new BigNumber(1.1),
      depositLimit: opts.depositLimitRaw ?? ui(opts.depositLimit),
      borrowLimit: opts.borrowLimitRaw ?? ui(opts.borrowLimit),
      totalAssetValueInitLimit: new BigNumber(0),
      interestRateConfig: {
        placeholder0: rate(0.8),
        placeholder1: rate(0.1),
        placeholder2: rate(1),
        insuranceFeeFixedApr: rate(0),
        insuranceIrFee: rate(0),
        protocolFixedFeeApr: rate(0),
        protocolIrFee: rate(0),
        protocolOriginationFee: rate(opts.originationFee ?? 0),
        zeroUtilRate: 0,
        hundredUtilRate: 0,
        points: [],
        curveType: 0,
      },
    },
  } as unknown as BankType;
}

function oraclePrice(price: number): OraclePrice {
  const p = {
    price: new BigNumber(price),
    confidence: new BigNumber(0),
    lowestPrice: new BigNumber(price),
    highestPrice: new BigNumber(price),
  };
  return { priceRealtime: p, priceWeighted: p, timestamp: new BigNumber(0) } as OraclePrice;
}

function account(opts: {
  freeCollateralUsd: number;
  liabilitiesUsd?: number;
  balances?: Array<{ bankPk: PublicKey; assetShares: BigNumber; liabilityShares?: BigNumber }>;
}): MarginfiAccountType {
  const liabilities = new BigNumber(opts.liabilitiesUsd ?? 0);
  const assets = new BigNumber(opts.freeCollateralUsd).plus(liabilities);
  return {
    address: Keypair.generate().publicKey,
    balances: (opts.balances ?? []).map((b) => ({
      active: true,
      bankPk: b.bankPk,
      assetShares: b.assetShares,
      liabilityShares: b.liabilityShares ?? new BigNumber(0),
    })),
    healthCache: {
      assetValue: assets,
      liabilityValue: liabilities,
      assetValueMaint: assets,
      liabilityValueMaint: liabilities,
      assetValueEquity: assets,
      liabilityValueEquity: liabilities,
      timestamp: new BigNumber(0),
      flags: [],
      prices: [],
      simulationStatus: HealthCacheStatus.COMPUTED,
    },
  } as unknown as MarginfiAccountType;
}

function ctx(b: BankType) {
  return {
    banksMap: new Map([[b.address.toBase58(), b]]),
    oraclePricesByBank: new Map([[b.address.toBase58(), oraclePrice(1)]]),
    bankAddress: b.address,
  };
}

// ----------------------------------------------------------------------------
// Max borrow
// ----------------------------------------------------------------------------

describe("computeMaxBorrowForBank bank-level clamps", () => {
  // $1000 free collateral, price 1, liab weight 1.25 → health-based max = 800
  const HEALTH_MAX = 800;
  const acc = account({ freeCollateralUsd: 1000 });

  it("returns health-based max when bank cap and liquidity are ample", () => {
    const b = bank({ totalDeposits: 10_000, totalBorrows: 0, depositLimit: 1e9, borrowLimit: 1e9 });
    const max = computeMaxBorrowForBank({
      account: acc,
      ...ctx(b),
      emodeImpactStatus: EmodeImpactStatus.InactiveEmode,
    });
    expect(max.toNumber()).toBeCloseTo(HEALTH_MAX, 6);
  });

  it("clamps to remaining borrow cap", () => {
    const b = bank({
      totalDeposits: 10_000,
      totalBorrows: 100,
      depositLimit: 1e9,
      borrowLimit: 500,
    });
    const max = computeMaxBorrowForBank({
      account: acc,
      ...ctx(b),
      emodeImpactStatus: EmodeImpactStatus.InactiveEmode,
    });
    expect(max.toNumber()).toBeCloseTo(400, 3);
  });

  it("clamps to available liquidity", () => {
    const b = bank({ totalDeposits: 300, totalBorrows: 50, depositLimit: 1e9, borrowLimit: 1e9 });
    const max = computeMaxBorrowForBank({
      account: acc,
      ...ctx(b),
      emodeImpactStatus: EmodeImpactStatus.InactiveEmode,
    });
    expect(max.toNumber()).toBeCloseTo(250, 3);
  });

  it("returns 0 when the borrow cap is exhausted", () => {
    const b = bank({
      totalDeposits: 10_000,
      totalBorrows: 600,
      depositLimit: 1e9,
      borrowLimit: 500,
    });
    const max = computeMaxBorrowForBank({
      account: acc,
      ...ctx(b),
      emodeImpactStatus: EmodeImpactStatus.InactiveEmode,
    });
    expect(max.toNumber()).toBe(0);
  });

  it("clamps to the bank rate limiter's remaining outflow", () => {
    const b = bank({
      totalDeposits: 10_000,
      totalBorrows: 0,
      depositLimit: 1e9,
      borrowLimit: 1e9,
      rateLimit: { max: 500, used: 200 },
    });
    const max = computeMaxBorrowForBank({
      account: acc,
      ...ctx(b),
      emodeImpactStatus: EmodeImpactStatus.InactiveEmode,
    });
    expect(max.toNumber()).toBeCloseTo(300, 6);
  });

  it("clamps to the group USD rate limiter converted at realtime price", () => {
    const b = bank({ totalDeposits: 10_000, totalBorrows: 0, depositLimit: 1e9, borrowLimit: 1e9 });
    const groupRateLimiter = {
      hourly: {
        maxOutflow: new BigNumber(0),
        windowDuration: 3600,
        windowStart: 0,
        prevWindowOutflow: new BigNumber(0),
        curWindowOutflow: new BigNumber(0),
      },
      daily: {
        maxOutflow: new BigNumber(1_000),
        windowDuration: 86400,
        windowStart: Math.floor(Date.now() / 1000) - 60,
        prevWindowOutflow: new BigNumber(0),
        curWindowOutflow: new BigNumber(750),
      },
    };
    const c = ctx(b);
    c.oraclePricesByBank.set(b.address.toBase58(), oraclePrice(2)); // $2 → 250 USD left = 125 tokens
    const max = computeMaxBorrowForBank({
      account: acc,
      ...c,
      emodeImpactStatus: EmodeImpactStatus.InactiveEmode,
      groupRateLimiter,
    });
    expect(max.toNumber()).toBeCloseTo(125, 6);
  });

  it("ignoreBankLimits bypasses the clamps", () => {
    const b = bank({ totalDeposits: 300, totalBorrows: 50, depositLimit: 1e9, borrowLimit: 100 });
    const max = computeMaxBorrowForBank({
      account: acc,
      ...ctx(b),
      emodeImpactStatus: EmodeImpactStatus.InactiveEmode,
      ignoreBankLimits: true,
    });
    expect(max.toNumber()).toBeCloseTo(HEALTH_MAX, 6);
  });
});

// ----------------------------------------------------------------------------
// Max withdraw
// ----------------------------------------------------------------------------

describe("computeMaxWithdrawForBank bank-level clamp", () => {
  it("returns entire balance when liquidity is ample", () => {
    const b = bank({ totalDeposits: 1000, totalBorrows: 0, depositLimit: 1e9, borrowLimit: 1e9 });
    const acc = account({
      freeCollateralUsd: 320,
      balances: [{ bankPk: b.address, assetShares: ui(400) }],
    });
    const max = computeMaxWithdrawForBank({ account: acc, ...ctx(b) });
    expect(max.toNumber()).toBeCloseTo(400, 6);
  });

  it("clamps to available liquidity", () => {
    const b = bank({ totalDeposits: 400, totalBorrows: 250, depositLimit: 1e9, borrowLimit: 1e9 });
    const acc = account({
      freeCollateralUsd: 320,
      balances: [{ bankPk: b.address, assetShares: ui(400) }],
    });
    const max = computeMaxWithdrawForBank({ account: acc, ...ctx(b) });
    expect(max.toNumber()).toBeCloseTo(150, 6);
  });

  it("clamps to the bank rate limiter's remaining outflow", () => {
    const b = bank({
      totalDeposits: 1000,
      totalBorrows: 0,
      depositLimit: 1e9,
      borrowLimit: 1e9,
      rateLimit: { max: 100, used: 30 },
    });
    const acc = account({
      freeCollateralUsd: 320,
      balances: [{ bankPk: b.address, assetShares: ui(400) }],
    });
    const max = computeMaxWithdrawForBank({ account: acc, ...ctx(b) });
    expect(max.toNumber()).toBeCloseTo(70, 6);
  });

  it("ignoreBankLimits bypasses the clamp", () => {
    const b = bank({ totalDeposits: 400, totalBorrows: 250, depositLimit: 1e9, borrowLimit: 1e9 });
    const acc = account({
      freeCollateralUsd: 320,
      balances: [{ bankPk: b.address, assetShares: ui(400) }],
    });
    const max = computeMaxWithdrawForBank({ account: acc, ...ctx(b), ignoreBankLimits: true });
    expect(max.toNumber()).toBeCloseTo(400, 6);
  });
});

// ----------------------------------------------------------------------------
// Max deposit
// ----------------------------------------------------------------------------

describe("computeMaxDepositForBank", () => {
  it("returns remaining deposit cap", () => {
    const b = bank({ totalDeposits: 600, totalBorrows: 0, depositLimit: 1000, borrowLimit: 1e9 });
    const max = computeMaxDepositForBank({ banksMap: ctx(b).banksMap, bankAddress: b.address });
    expect(max.toNumber()).toBeCloseTo(400, 3);
  });

  it("is capped by wallet balance when provided", () => {
    const b = bank({ totalDeposits: 600, totalBorrows: 0, depositLimit: 1000, borrowLimit: 1e9 });
    const max = computeMaxDepositForBank({
      banksMap: ctx(b).banksMap,
      bankAddress: b.address,
      walletBalance: 100,
    });
    expect(max.toNumber()).toBe(100);
  });

  it("returns 0 when the deposit cap is exhausted", () => {
    const b = bank({ totalDeposits: 1000, totalBorrows: 0, depositLimit: 1000, borrowLimit: 1e9 });
    const max = computeMaxDepositForBank({ banksMap: ctx(b).banksMap, bankAddress: b.address });
    expect(max.toNumber()).toBe(0);
  });

  it("applies the asset share value multiplier (integrated banks)", () => {
    const b = bank({ totalDeposits: 600, totalBorrows: 0, depositLimit: 1000, borrowLimit: 1e9 });
    const max = computeMaxDepositForBank({
      banksMap: ctx(b).banksMap,
      bankAddress: b.address,
      assetShareValueMultiplierByBank: new Map([[b.address.toBase58(), new BigNumber(1.5)]]),
    });
    expect(max.toNumber()).toBeCloseTo(600, 3);
  });

  it("throws for unknown bank", () => {
    expect(() =>
      computeMaxDepositForBank({ banksMap: new Map(), bankAddress: Keypair.generate().publicKey })
    ).toThrow(/not found/);
  });
});

// ----------------------------------------------------------------------------
// Program-parity details (audited against marginfi-v2 state/bank.rs)
// ----------------------------------------------------------------------------

describe("cap strictness / sentinel / Drift scaling", () => {
  it("remaining cap is floor(limit - total - 1) native (program check is `total >= limit`)", () => {
    const b = bank({ totalDeposits: 600, totalBorrows: 100, depositLimit: 1000, borrowLimit: 500 });
    // zero the rate curve so the accrued-interest buffer is exactly 0
    (b.config.interestRateConfig as any).placeholder1 = new BigNumber(0);
    (b.config.interestRateConfig as any).placeholder2 = new BigNumber(0);
    const { depositCapacity, borrowCapacity } = computeRemainingCapacity(b);
    expect(depositCapacity.toNumber()).toBe(ui(400).minus(1).toNumber());
    expect(borrowCapacity.toNumber()).toBe(ui(400).minus(1).toNumber());
  });

  it("u64::MAX limit is inactive → unbounded", () => {
    const b = bank({
      totalDeposits: 600,
      totalBorrows: 100,
      depositLimit: 0,
      borrowLimit: 0,
      depositLimitRaw: U64_MAX,
      borrowLimitRaw: U64_MAX,
    });
    expect(computeBankDepositCapRemaining(b)).toBe(Infinity);
    const maxDep = computeMaxDepositForBank({ banksMap: ctx(b).banksMap, bankAddress: b.address });
    expect(maxDep.isFinite()).toBe(false);
    const maxBorrow = computeMaxBorrowForBank({
      account: account({ freeCollateralUsd: 1000 }),
      ...ctx(b),
      emodeImpactStatus: EmodeImpactStatus.InactiveEmode,
    });
    expect(maxBorrow.toNumber()).toBeCloseTo(500, 3); // liquidity-bound only (600-100)
  });

  it("Drift banks scale depositLimit to 9-dec scaled-balance units", () => {
    // mintDecimals 6 → limit * 1e3; deposits are already in scaled units in the fixture
    const b = bank({
      totalDeposits: 600_000,
      totalBorrows: 0,
      depositLimit: 1000,
      borrowLimit: 0,
      assetTag: AssetTag.DRIFT,
    });
    // scaled limit = 1000e6 * 1e3 = 1e12; total = 600_000e6 = 6e11 → remaining 4e11 - 1 native
    const { depositCapacity } = computeRemainingCapacity(b);
    expect(depositCapacity.toNumber()).toBe(4e11 - 1);
  });
});

describe("origination fee on borrow", () => {
  // $1000 free collateral, price 1, liab weight 1.25, fee 1% → health max = 800 / 1.01
  it("divides health-based, cap and liquidity bounds by (1 + fee), not the rate limiter", () => {
    const acc = account({ freeCollateralUsd: 1000 });
    const c = (b: BankType) => ({
      account: acc,
      ...ctx(b),
      emodeImpactStatus: EmodeImpactStatus.InactiveEmode,
    });

    const bHealth = bank({
      totalDeposits: 1e6,
      totalBorrows: 0,
      depositLimit: 1e9,
      borrowLimit: 1e9,
      originationFee: 0.01,
    });
    expect(computeMaxBorrowForBank(c(bHealth)).toNumber()).toBeCloseTo(800 / 1.01, 6);

    const bCap = bank({
      totalDeposits: 1e6,
      totalBorrows: 100,
      depositLimit: 1e9,
      borrowLimit: 500,
      originationFee: 0.01,
    });
    expect(computeMaxBorrowForBank(c(bCap)).toNumber()).toBeCloseTo(400 / 1.01, 3);

    const bLiq = bank({
      totalDeposits: 300,
      totalBorrows: 50,
      depositLimit: 1e9,
      borrowLimit: 1e9,
      originationFee: 0.01,
    });
    expect(computeMaxBorrowForBank(c(bLiq)).toNumber()).toBeCloseTo(250 / 1.01, 6);

    const bRl = bank({
      totalDeposits: 1e6,
      totalBorrows: 0,
      depositLimit: 1e9,
      borrowLimit: 1e9,
      originationFee: 0.01,
      rateLimit: { max: 500, used: 200 },
    });
    expect(computeMaxBorrowForBank(c(bRl)).toNumber()).toBeCloseTo(300, 6);
  });
});

describe("liquidity projected through interest accrual", () => {
  it("shrinks available liquidity by (borrows*borrowRate - deposits*lendRate) over the projection window", () => {
    // legacy curve: util 0.5 / optimal 0.8 → base = 0.5*0.1/0.8 = 0.0625; lending = base*util = 0.03125
    // one year stale: drain = 500*0.0625 - 1000*0.03125 = 0 → symmetric; use fees to create drain
    const year = 365 * 24 * 3600;
    const b = bank({
      totalDeposits: 1000,
      totalBorrows: 500,
      depositLimit: 1e9,
      borrowLimit: 1e9,
      lastUpdate: Math.floor(Date.now() / 1000) - year,
    });
    (b.config.interestRateConfig as any).protocolIrFee = new BigNumber(0.2); // borrowRate = 0.0625*1.2 = 0.075
    const acc = account({
      freeCollateralUsd: 320,
      balances: [{ bankPk: b.address, assetShares: ui(1000) }],
    });
    const max = computeMaxWithdrawForBank({ account: acc, ...ctx(b) });
    // drain/yr = 500*0.075 - 1000*0.03125 = 6.25; projection = max(2*age, age+120s) = 2 years
    // liquidity 500 - 12.5 = 487.5
    expect(max.toNumber()).toBeCloseTo(487.5, 2);
  });
});
