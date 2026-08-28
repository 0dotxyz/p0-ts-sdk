import { describe, expect, it } from "vitest";
import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";

import {
  DEFAULT_RECENT_SLOT_DURATION_MS,
  KaminoInterestRateBasis,
  KaminoReserve,
  SECONDS_PER_YEAR,
  SLOTS_PER_YEAR,
  calculateAPYFromAPR,
  calculateKaminoEstimatedBorrowRate,
  calculateKaminoEstimatedSupplyRate,
  calculateKaminoSupplyAPY,
  calculateSlotAdjustmentFactor,
  generateKaminoReserveCurve,
  generateKaminoReserveCurveFromReserve,
  getFixedHostInterestRate,
  getKaminoInterestRateBasis,
  getKaminoRateBasis,
  getProtocolTakeRatePct,
} from "~/vendor/klend";

const pk = (seed: number) =>
  new PublicKey(Buffer.from(Array.from({ length: 32 }, (_, i) => (seed + i) % 256)));

// Scaled-fraction amounts are Q60 (value * 2^60).
const sf = (amount: number) => new BN(amount).shln(60);

/**
 * Reserve with 50% utilization (50 available + 50 borrowed, no fees) and a flat
 * 10% borrow rate curve, so curve rate = 0.10 at every utilization.
 */
const makeReserve = (config: Partial<KaminoReserve["config"]> = {}): KaminoReserve => ({
  lendingMarket: pk(1),
  farmCollateral: pk(2),
  liquidity: {
    mintPubkey: pk(3),
    supplyVault: pk(4),
    mintDecimals: new BN(6),
    availableAmount: new BN(50),
    borrowedAmountSf: sf(50),
    accumulatedProtocolFeesSf: new BN(0),
    accumulatedReferrerFeesSf: new BN(0),
    pendingReferrerFeesSf: new BN(0),
  },
  collateral: {
    mintPubkey: pk(5),
    mintTotalSupply: new BN(100),
    supplyVault: pk(6),
  },
  config: {
    protocolTakeRatePct: 0,
    hostFixedInterestRateBps: 0,
    interestRateBasis: KaminoInterestRateBasis.Legacy,
    depositLimit: new BN("10000000000000000"),
    borrowLimit: new BN("9000000000000000"),
    borrowRateCurve: {
      points: [
        { utilizationRateBps: 0, borrowRateBps: 1000 },
        { utilizationRateBps: 10000, borrowRateBps: 1000 },
      ],
    },
    tokenInfo: {
      scopeConfiguration: { priceFeed: pk(7) },
      switchboardConfiguration: { priceAggregator: pk(8), twapAggregator: pk(9) },
      pythConfiguration: { price: pk(10) },
    },
    ...config,
  },
});

const legacy = makeReserve({ interestRateBasis: KaminoInterestRateBasis.Legacy });
const trueApr = makeReserve({ interestRateBasis: KaminoInterestRateBasis.TrueApr });

describe("kamino interest rate basis", () => {
  it("resolves the basis, defaulting a missing field to Legacy", () => {
    expect(getKaminoInterestRateBasis(legacy)).toBe(KaminoInterestRateBasis.Legacy);
    expect(getKaminoInterestRateBasis(trueApr)).toBe(KaminoInterestRateBasis.TrueApr);

    const { interestRateBasis, ...config } = legacy.config;
    expect(getKaminoInterestRateBasis({ ...legacy, config })).toBe(
      KaminoInterestRateBasis.Legacy
    );
    expect(calculateKaminoSupplyAPY({ ...legacy, config }, 400)).toBe(
      calculateKaminoSupplyAPY(legacy, 400)
    );
  });

  it("rejects an unknown basis", () => {
    const unknown = makeReserve({ interestRateBasis: 2 });
    expect(() => getKaminoInterestRateBasis(unknown)).toThrow(
      "Unsupported Kamino interest rate basis: 2"
    );
    expect(() => calculateKaminoSupplyAPY(unknown)).toThrow(
      "Unsupported Kamino interest rate basis"
    );
    expect(() => generateKaminoReserveCurveFromReserve(unknown)).toThrow(
      "Unsupported Kamino interest rate basis"
    );
  });

  it("uses slot adjustment and per-slot compounding for Legacy", () => {
    expect(getKaminoRateBasis(legacy, 400)).toEqual({
      multiplier: 1.25,
      periodsPerYear: SLOTS_PER_YEAR,
    });
    expect(getKaminoRateBasis(legacy, 200)).toEqual({
      multiplier: 2.5,
      periodsPerYear: SLOTS_PER_YEAR,
    });
    expect(calculateSlotAdjustmentFactor(legacy, 400)).toBe(1.25);
    expect(getKaminoRateBasis(legacy).multiplier).toBe(
      1000 / 2 / DEFAULT_RECENT_SLOT_DURATION_MS
    );
  });

  it("uses no slot adjustment and per-second compounding for TrueApr", () => {
    expect(getKaminoRateBasis(trueApr, 400)).toEqual({
      multiplier: 1,
      periodsPerYear: SECONDS_PER_YEAR,
    });
    expect(calculateSlotAdjustmentFactor(trueApr, 400)).toBe(1);
    expect(calculateSlotAdjustmentFactor(trueApr, 200)).toBe(1);
  });

  it("requires a positive slot duration only for Legacy", () => {
    expect(() => getKaminoRateBasis(legacy, 0)).toThrow("must be positive");
    expect(() => getKaminoRateBasis(legacy, Number.NaN)).toThrow("must be positive");
    expect(() => calculateKaminoSupplyAPY(legacy, -1)).toThrow("must be positive");

    expect(() => getKaminoRateBasis(trueApr, 0)).not.toThrow();
    expect(() => getKaminoRateBasis(trueApr, Number.NaN)).not.toThrow();
  });
});

describe("kamino rate calculations", () => {
  it("scales Legacy rates with slot duration", () => {
    expect(calculateKaminoEstimatedBorrowRate(legacy, 400)).toBeCloseTo(0.125, 12);
    expect(calculateKaminoEstimatedBorrowRate(legacy, 200)).toBeCloseTo(0.25, 12);
    expect(calculateKaminoEstimatedSupplyRate(legacy, 400)).toBeCloseTo(0.0625, 12);
    expect(calculateKaminoEstimatedSupplyRate(legacy, 200)).toBeCloseTo(0.125, 12);

    const apy400 = calculateKaminoSupplyAPY(legacy, 400);
    const apy200 = calculateKaminoSupplyAPY(legacy, 200);
    expect(apy200).toBeGreaterThan(apy400);
    expect(apy400).toBeCloseTo(
      Math.pow(1 + 0.0625 / SLOTS_PER_YEAR, SLOTS_PER_YEAR) - 1,
      12
    );
    expect(apy200).toBeCloseTo(
      Math.pow(1 + 0.125 / SLOTS_PER_YEAR, SLOTS_PER_YEAR) - 1,
      12
    );
  });

  it("keeps TrueApr rates invariant to slot duration", () => {
    const borrow400 = calculateKaminoEstimatedBorrowRate(trueApr, 400);
    const borrow200 = calculateKaminoEstimatedBorrowRate(trueApr, 200);
    const supply400 = calculateKaminoEstimatedSupplyRate(trueApr, 400);
    const supply200 = calculateKaminoEstimatedSupplyRate(trueApr, 200);
    const apy400 = calculateKaminoSupplyAPY(trueApr, 400);
    const apy200 = calculateKaminoSupplyAPY(trueApr, 200);

    expect(borrow400).toBeCloseTo(0.1, 12);
    expect(borrow200).toBe(borrow400);
    expect(supply400).toBeCloseTo(0.05, 12);
    expect(supply200).toBe(supply400);
    expect(apy200).toBe(apy400);
    expect(apy400).toBeCloseTo(
      Math.pow(1 + 0.05 / SECONDS_PER_YEAR, SECONDS_PER_YEAR) - 1,
      12
    );

    // Slot duration is never read for TrueApr, so even an unusable value yields the same result.
    expect(calculateKaminoEstimatedBorrowRate(trueApr, Number.NaN)).toBe(borrow400);
    expect(calculateKaminoSupplyAPY(trueApr, Number.NaN)).toBe(apy400);
    expect(calculateKaminoSupplyAPY(trueApr)).toBe(apy400);
  });

  it("yields different numbers for the same reserve under each basis", () => {
    expect(calculateKaminoSupplyAPY(legacy, 400)).not.toBe(
      calculateKaminoSupplyAPY(trueApr, 400)
    );
  });

  it("compounds APR by the requested number of periods", () => {
    expect(calculateAPYFromAPR(0.05)).toBe(
      Math.pow(1 + 0.05 / SLOTS_PER_YEAR, SLOTS_PER_YEAR) - 1
    );
    expect(calculateAPYFromAPR(0.05, SECONDS_PER_YEAR)).toBe(
      Math.pow(1 + 0.05 / SECONDS_PER_YEAR, SECONDS_PER_YEAR) - 1
    );
  });
});

describe("kamino curve generation", () => {
  const withHost = (basis: KaminoInterestRateBasis) =>
    makeReserve({
      interestRateBasis: basis,
      hostFixedInterestRateBps: 25,
      protocolTakeRatePct: 15,
    });

  it("changes the Legacy curve with slot duration", () => {
    const reserve = withHost(KaminoInterestRateBasis.Legacy);
    const curve400 = generateKaminoReserveCurveFromReserve(reserve, 400);
    const curve200 = generateKaminoReserveCurveFromReserve(reserve, 200);

    expect(curve400).toHaveLength(101);
    expect(curve200[50]!.borrowAPY).toBeGreaterThan(curve400[50]!.borrowAPY);
    expect(curve200[50]!.supplyAPY).toBeGreaterThan(curve400[50]!.supplyAPY);

    // Matches the explicit-argument form used by consumers.
    expect(curve400).toEqual(
      generateKaminoReserveCurve(
        reserve.config.borrowRateCurve.points,
        calculateSlotAdjustmentFactor(reserve, 400),
        getFixedHostInterestRate(reserve),
        getProtocolTakeRatePct(reserve),
        SLOTS_PER_YEAR
      )
    );
  });

  it("keeps the TrueApr curve invariant to slot duration", () => {
    const reserve = withHost(KaminoInterestRateBasis.TrueApr);
    const curve400 = generateKaminoReserveCurveFromReserve(reserve, 400);
    const curve200 = generateKaminoReserveCurveFromReserve(reserve, 200);

    expect(curve400).toHaveLength(101);
    expect(curve200).toEqual(curve400);
    expect(generateKaminoReserveCurveFromReserve(reserve, Number.NaN)).toEqual(curve400);

    // At 50% utilization: borrow APR = 0.10 + 0.0025, supply APR = 0.5 * borrow * 0.85.
    const borrowApr = 0.1025;
    const supplyApr = 0.5 * borrowApr * 0.85;
    expect(curve400[50]!.borrowAPY).toBeCloseTo(
      (Math.pow(1 + borrowApr / SECONDS_PER_YEAR, SECONDS_PER_YEAR) - 1) * 100,
      10
    );
    expect(curve400[50]!.supplyAPY).toBeCloseTo(
      (Math.pow(1 + supplyApr / SECONDS_PER_YEAR, SECONDS_PER_YEAR) - 1) * 100,
      10
    );

    // Consumers passing `calculateSlotAdjustmentFactor` get the multiplier-invariant curve too.
    expect(
      generateKaminoReserveCurve(
        reserve.config.borrowRateCurve.points,
        calculateSlotAdjustmentFactor(reserve, 200),
        getFixedHostInterestRate(reserve),
        getProtocolTakeRatePct(reserve),
        SECONDS_PER_YEAR
      )
    ).toEqual(curve400);
  });
});
