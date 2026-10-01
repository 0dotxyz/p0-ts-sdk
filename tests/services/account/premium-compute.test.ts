import { AnchorProvider, Program, Wallet } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import BigNumber from "bignumber.js";
import BN from "bn.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MARGINFI_IDL, MarginfiIdlType } from "~/idl";
import {
  BalanceType,
  computeBalancePremium,
  computeNetApy,
  computeProjectedActiveBalancesNoCpi,
  computeQuantity,
  getBalanceUsdValueWithPriceBias,
  HealthCacheStatus,
  MarginfiAccountType,
  MarginRequirementType,
} from "~/services/account";
import { BankType, OperationalState, RiskTier } from "~/services/bank";
import { OraclePrice } from "~/services/price";
import syncInstructions from "~/sync-instructions";
import type { MarginfiProgram } from "~/types";

const YEAR = 31_536_000;
const NOW = 1_800_000_000;
const usdc = (n: number) => new BigNumber(n).times(1e6);

function bank(
  opts: { premiumActive?: boolean; activatedAt?: number; liabilityShareValue?: number } = {}
): BankType {
  return {
    address: Keypair.generate().publicKey,
    mint: Keypair.generate().publicKey,
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
  bankPk: PublicKey;
  principal: number;
  rate: number;
  outstanding?: number;
  lastUpdate: number;
}): BalanceType {
  return {
    active: true,
    bankPk: opts.bankPk,
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
    const balance = debt({ bankPk: b.address, principal: 1000, rate: 0.01, lastUpdate: NOW - YEAR });
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
    const balance = debt({ bankPk: b.address, principal: 1000, rate: 0.01, lastUpdate: NOW - YEAR });
    expect(computeBalancePremium(balance, b, NOW).toNumber()).toBeCloseTo(usdc(11).toNumber(), 3);
  });

  it("starts accruing at the bank's premium activation, not before", () => {
    const b = bank({ activatedAt: NOW - YEAR / 2 });
    const balance = debt({ bankPk: b.address, principal: 1000, rate: 0.01, lastUpdate: NOW - YEAR });
    expect(computeBalancePremium(balance, b, NOW).toNumber()).toBe(usdc(5).toNumber());
  });

  it("only counts the accrued premium for uninitialized balances and clock skew", () => {
    const b = bank();
    const fresh = debt({ bankPk: b.address, principal: 1000, rate: 0.5, outstanding: 2, lastUpdate: 0 });
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
      ...debt({ bankPk: b.address, principal: 0, rate: 0.5, outstanding: 3, lastUpdate: NOW - YEAR }),
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
    const balance = debt({ bankPk: b.address, principal: 1000, rate: 0.01, lastUpdate: NOW - YEAR });
    expect(computeQuantity(balance, b).liabilities.toNumber()).toBe(usdc(1010).toNumber());
  });

  it("prices premium like principal in health: high-bias price x liability weight", () => {
    const b = bank();
    const balance = debt({ bankPk: b.address, principal: 1000, rate: 0.01, lastUpdate: NOW - YEAR });
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
      banksMap: new Map([[b.address.toBase58(), b]]),
      oraclePricesByBank: new Map([[b.address.toBase58(), oraclePrice(1)]]),
    };

    const withPremium = computeNetApy(params);
    const withoutPremium = computeNetApy({
      ...params,
      banksMap: new Map([[b.address.toBase58(), { ...b, premiumActive: false }]]),
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

  const program = new Program<MarginfiIdlType>(
    MARGINFI_IDL,
    new AnchorProvider(new Connection("http://127.0.0.1:1"), {} as Wallet, {})
  ) as unknown as MarginfiProgram;

  function project(balance: BalanceType, b: BankType, amount: number, repayAll = false) {
    const account = {
      address: Keypair.generate().publicKey,
      balances: [balance],
    } as unknown as MarginfiAccountType;
    const ix = syncInstructions.makeRepayIx(
      program.programId,
      {
        group: Keypair.generate().publicKey,
        marginfiAccount: account.address,
        authority: Keypair.generate().publicKey,
        signerTokenAccount: Keypair.generate().publicKey,
        bank: b.address,
        tokenProgram: Keypair.generate().publicKey,
      },
      { amount: new BN(usdc(amount).toString()), repayAll }
    );
    return computeProjectedActiveBalancesNoCpi({
      account,
      instructions: [ix],
      program,
      banksMap: new Map([[b.address.toBase58(), b]]),
      assetShareValueMultiplierByBank: new Map(),
    }).projectedBalances[0];
  }

  it("settles premium before principal (vb03: repay 4 of 10 premium, shares unchanged)", () => {
    const b = bank();
    const balance = debt({ bankPk: b.address, principal: 1000, rate: 0.01, lastUpdate: NOW - YEAR });
    const projected = project(balance, b, 4);
    expect(projected.liabilityShares.toNumber()).toBe(usdc(1000).toNumber());
    expect(projected.premiumOutstanding.toNumber()).toBe(usdc(6).toNumber());
    expect(computeBalancePremium(projected, b, NOW).toNumber()).toBe(usdc(6).toNumber());
  });

  it("repays principal with whatever exceeds the premium", () => {
    const b = bank();
    const balance = debt({ bankPk: b.address, principal: 1000, rate: 0.01, lastUpdate: NOW - YEAR });
    const projected = project(balance, b, 110);
    expect(projected.premiumOutstanding.isZero()).toBe(true);
    expect(projected.liabilityShares.toNumber()).toBe(usdc(900).toNumber());
  });

  it("clears the premium on repay-all", () => {
    const b = bank();
    const balance = debt({ bankPk: b.address, principal: 1000, rate: 0.01, lastUpdate: NOW - YEAR });
    const projected = project(balance, b, 0, true);
    expect(projected.active).toBe(false);
    expect(projected.premiumOutstanding.isZero()).toBe(true);
    expect(projected.premiumRate.isZero()).toBe(true);
  });
});
