import { BigNumber } from "bignumber.js";
import { describe, it, expect } from "vitest";

import { addr } from "../../../helpers/addresses";
import { makeBank } from "../../../helpers/factories";

import {
  computeRemainingCapacity,
  isStandardBorrowable,
  isStandardDepositable,
  AssetTag,
  OperationalState,
  BankType,
} from "~/services/bank";

function bank(opts: {
  assetTag: AssetTag;
  operationalState: OperationalState;
  borrowLimit: number;
}): BankType {
  return {
    address: addr(),
    mint: addr(),
    config: {
      assetTag: opts.assetTag,
      operationalState: opts.operationalState,
      borrowLimit: new BigNumber(opts.borrowLimit),
    },
  } as unknown as BankType;
}

const ui = (n: number) => new BigNumber(n).times(10 ** 6);

// Updated now, so the accrued-interest buffer projects only the execution headroom
function cappedBank(opts: {
  totalDeposits: number;
  totalBorrows: number;
  depositLimit: number;
  borrowLimit: number;
  assetTag?: AssetTag;
}): BankType {
  const rate = (n: number) => new BigNumber(n);
  return makeBank({
    totalAssetShares: ui(opts.totalDeposits),
    totalLiabilityShares: ui(opts.totalBorrows),
    lastUpdate: Math.floor(Date.now() / 1000),
    config: {
      assetTag: opts.assetTag ?? AssetTag.DEFAULT,
      depositLimit: ui(opts.depositLimit),
      borrowLimit: ui(opts.borrowLimit),
      interestRateConfig: {
        placeholder0: rate(0.8),
        placeholder1: rate(0.1),
        placeholder2: rate(1),
        insuranceFeeFixedApr: rate(0),
        insuranceIrFee: rate(0),
        protocolFixedFeeApr: rate(0),
        protocolIrFee: rate(0),
        protocolOriginationFee: rate(0),
        zeroUtilRate: 0,
        hundredUtilRate: 0,
        points: [],
        curveType: 0,
      },
    },
  });
}

describe("isStandardBorrowable / isStandardDepositable", () => {
  it("native DEFAULT/SOL operational banks are borrowable + depositable", () => {
    const def = bank({
      assetTag: AssetTag.DEFAULT,
      operationalState: OperationalState.Operational,
      borrowLimit: 100,
    });
    const sol = bank({
      assetTag: AssetTag.SOL,
      operationalState: OperationalState.Operational,
      borrowLimit: 100,
    });
    expect(isStandardBorrowable(def)).toBe(true);
    expect(isStandardDepositable(def)).toBe(true);
    expect(isStandardBorrowable(sol)).toBe(true);
  });

  it("integration wrappers (Kamino/Drift/JupLend) are neither", () => {
    const kamino = bank({
      assetTag: AssetTag.KAMINO,
      operationalState: OperationalState.Operational,
      borrowLimit: 0,
    });
    expect(isStandardBorrowable(kamino)).toBe(false);
    expect(isStandardDepositable(kamino)).toBe(false);
  });

  it("ReduceOnly excludes both; zero borrowLimit excludes only borrowable", () => {
    const reduceOnly = bank({
      assetTag: AssetTag.DEFAULT,
      operationalState: OperationalState.ReduceOnly,
      borrowLimit: 100,
    });
    expect(isStandardBorrowable(reduceOnly)).toBe(false);
    expect(isStandardDepositable(reduceOnly)).toBe(false);

    const noBorrow = bank({
      assetTag: AssetTag.DEFAULT,
      operationalState: OperationalState.Operational,
      borrowLimit: 0,
    });
    expect(isStandardBorrowable(noBorrow)).toBe(false);
    expect(isStandardDepositable(noBorrow)).toBe(true); // deposit doesn't need a borrow limit
  });
});

describe("computeRemainingCapacity", () => {
  it("remaining cap is floor(limit - total - 1) native (program check is `total >= limit`)", () => {
    const b = cappedBank({
      totalDeposits: 600,
      totalBorrows: 100,
      depositLimit: 1000,
      borrowLimit: 500,
    });
    // zero the rate curve so the accrued-interest buffer is exactly 0
    b.config.interestRateConfig.placeholder1 = new BigNumber(0);
    b.config.interestRateConfig.placeholder2 = new BigNumber(0);
    const { depositCapacity, borrowCapacity } = computeRemainingCapacity(b);
    expect(depositCapacity.toNumber()).toBe(ui(400).minus(1).toNumber());
    expect(borrowCapacity.toNumber()).toBe(ui(400).minus(1).toNumber());
  });

  it("Drift banks scale depositLimit to 9-dec scaled-balance units", () => {
    // mintDecimals 6 → limit * 1e3; deposits are already in scaled units in the fixture
    const b = cappedBank({
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
