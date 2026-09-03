/**
 * Kamino Lending Protocol - Interest Rate Utilities
 *
 * Provides utilities for calculating interest rates, reserve metrics, and curve generation
 * for the Kamino lending protocol.
 *
 * Extracted all needed functions & constants out of their SDK
 */

import Decimal from "decimal.js";

import { Fraction } from "../../classes";
import {
  ONE_HUNDRED_PCT_IN_BPS,
  SLOTS_PER_YEAR,
  SLOTS_PER_SECOND,
  SECONDS_PER_YEAR,
  DEFAULT_RECENT_SLOT_DURATION_MS,
} from "../../constants";
import { KaminoBorrowRateCurvePoint, KaminoInterestRateBasis, KaminoReserve } from "../../types";

// =============================================================================
// INTERFACES
// =============================================================================

export interface KlendInterestRateCurvePoint {
  utilization: number; // 0-100 percentage
  borrowAPY: number; // percentage
  supplyAPY: number; // percentage
}

export interface KaminoReserveCurveData {
  reserveAddress: string;
  curvePoints: KlendInterestRateCurvePoint[];
}

/**
 * How a reserve's configured (curve) rate is turned into a realized annual rate.
 * `multiplier` scales the curve rate; `periodsPerYear` is the compounding
 * granularity used to convert APR to APY.
 */
export interface KaminoRateBasis {
  multiplier: number;
  periodsPerYear: number;
}

// =============================================================================
// CORE MATH UTILITIES
// =============================================================================

/**
 * Linear interpolation between two points
 */
export const interpolateLinear = (
  x: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number
): number => {
  return y0 + ((x - x0) * (y1 - y0)) / (x1 - x0);
};

/**
 * Calculate borrow rate from utilization using interest rate curve
 * @param currentUtilization - Current utilization ratio (0-1)
 * @param curve - Array of [utilization, rate] points
 * @returns Borrow rate for the given utilization
 */
export const getKaminoBorrowRate = (
  currentUtilization: number,
  curve: [number, number][]
): number => {
  let [x0, y0, x1, y1] = [0, 0, 0, 0];

  if (currentUtilization > 1) {
    currentUtilization = 1;
  }

  for (let i = 1; i < curve.length; i++) {
    const currentPoint = curve[i];
    const previousPoint = curve[i - 1];

    if (!currentPoint || !previousPoint) {
      continue;
    }

    const [pointUtilization, pointRate] = currentPoint;
    if (pointUtilization === currentUtilization) {
      return pointRate;
    }

    if (currentUtilization <= pointUtilization) {
      x0 = previousPoint[0];
      y0 = previousPoint[1];
      x1 = currentPoint[0];
      y1 = currentPoint[1];
      break;
    }
  }

  if (x0 === 0 && y0 === 0 && x1 === 0 && y1 === 0) {
    const lastPoint = curve[curve.length - 1];
    return lastPoint ? lastPoint[1] : 0;
  }

  return interpolateLinear(currentUtilization, x0, y0, x1, y1);
};

// =============================================================================
// APR/APY CONVERSIONS
// =============================================================================

/**
 * Convert APR to APY using compound interest formula
 * APY = (1 + APR/n)^n - 1
 * @param apr - Annual Percentage Rate as decimal (e.g., 0.05 for 5%)
 * @param periodsPerYear - Compounding periods per year (defaults to SLOTS_PER_YEAR;
 *   use `getKaminoRateBasis(reserve).periodsPerYear` for basis-aware compounding)
 * @returns Annual Percentage Yield as decimal
 */
export function calculateAPYFromAPR(apr: number, periodsPerYear: number = SLOTS_PER_YEAR): number {
  return Math.pow(1 + apr / periodsPerYear, periodsPerYear) - 1;
}

// =============================================================================
// RESERVE SUPPLY & UTILIZATION
// =============================================================================

/**
 * Calculate total supply of a reserve
 * Formula: available liquidity + borrowed - protocol fees - referrer fees
 * @param reserve - The Kamino reserve
 * @returns Total supply in lamports
 */
export function getKaminoTotalSupply(reserve: KaminoReserve): Decimal {
  const liquidityAvailableAmount = new Decimal(reserve.liquidity.availableAmount.toString());
  const borrowedAmount = new Fraction(reserve.liquidity.borrowedAmountSf).toDecimal();
  const accumulatedProtocolFee = new Fraction(
    reserve.liquidity.accumulatedProtocolFeesSf
  ).toDecimal();
  const accumulatedReferrerFees = new Fraction(
    reserve.liquidity.accumulatedReferrerFeesSf
  ).toDecimal();
  const pendingReferrerFees = new Fraction(reserve.liquidity.pendingReferrerFeesSf).toDecimal();

  return liquidityAvailableAmount
    .add(borrowedAmount)
    .sub(accumulatedProtocolFee)
    .sub(accumulatedReferrerFees)
    .sub(pendingReferrerFees);
}

/**
 * Calculate utilization ratio of a reserve
 * Formula: total borrowed / total supply
 * @param reserve - The Kamino reserve
 * @returns Utilization ratio (0-1, e.g., 0.75 = 75% utilized)
 */
export function calculateUtilizationRatio(reserve: KaminoReserve): number {
  const totalBorrows = new Fraction(reserve.liquidity.borrowedAmountSf).toDecimal();
  const totalSupply = getKaminoTotalSupply(reserve);
  if (totalSupply.eq(0)) {
    return 0;
  }
  return totalBorrows.dividedBy(totalSupply).toNumber();
}

// =============================================================================
// INTEREST RATE BASIS & SLOT ADJUSTMENT
// =============================================================================

/**
 * Resolve a reserve's interest rate basis, defaulting to `Legacy` when the
 * field is absent (reserves serialized before it existed).
 * @throws if the on-chain value is not a known basis
 */
export function getKaminoInterestRateBasis(reserve: KaminoReserve): KaminoInterestRateBasis {
  const basis = reserve.config.interestRateBasis ?? KaminoInterestRateBasis.Legacy;
  switch (basis) {
    case KaminoInterestRateBasis.Legacy:
    case KaminoInterestRateBasis.TrueApr:
      return basis;
    default:
      throw new Error(`Unsupported Kamino interest rate basis: ${basis}`);
  }
}

/**
 * Calculate slot adjustment factor based on recent slot duration
 * Used to adjust Legacy-basis rates based on actual blockchain performance
 * @param recentSlotDurationMs - Recent slot duration in milliseconds
 * @returns Slot adjustment factor
 */
export function slotAdjustmentFactor(
  recentSlotDurationMs: number = DEFAULT_RECENT_SLOT_DURATION_MS
): number {
  return 1000 / SLOTS_PER_SECOND / recentSlotDurationMs;
}

/**
 * Rate multiplier and compounding granularity for a reserve, per its
 * interest rate basis (1:1 with klend-sdk `KaminoReserve.rateAdjustmentFactor()`
 * and `accrualUnitsPerYear()`).
 *
 * - `Legacy`: curve rates are slot-year APRs, so they are scaled by the observed
 *   slot duration and compounded per slot.
 * - `TrueApr`: curve rates are wall-clock APRs; `recentSlotDurationMs` is ignored
 *   and rates compound per second.
 *
 * @param reserve - The Kamino reserve
 * @param recentSlotDurationMs - Observed slot duration; only read for `Legacy`
 * @throws for an unsupported basis, or a non-positive slot duration on `Legacy`
 */
export function getKaminoRateBasis(
  reserve: KaminoReserve,
  recentSlotDurationMs: number = DEFAULT_RECENT_SLOT_DURATION_MS
): KaminoRateBasis {
  switch (getKaminoInterestRateBasis(reserve)) {
    case KaminoInterestRateBasis.Legacy:
      if (!Number.isFinite(recentSlotDurationMs) || recentSlotDurationMs <= 0) {
        throw new Error(
          `Kamino recent slot duration must be positive, got ${recentSlotDurationMs}`
        );
      }
      return {
        multiplier: slotAdjustmentFactor(recentSlotDurationMs),
        periodsPerYear: SLOTS_PER_YEAR,
      };
    case KaminoInterestRateBasis.TrueApr:
      return { multiplier: 1, periodsPerYear: SECONDS_PER_YEAR };
  }
}

/**
 * Calculate the rate multiplier for a reserve (1:1 with klend-sdk
 * `KaminoReserve.rateAdjustmentFactor()`): the slot adjustment factor for a
 * `Legacy` reserve, `1` for a `TrueApr` one.
 */
export function calculateSlotAdjustmentFactor(
  reserve: KaminoReserve,
  recentSlotDurationMs: number = DEFAULT_RECENT_SLOT_DURATION_MS
): number {
  return getKaminoRateBasis(reserve, recentSlotDurationMs).multiplier;
}

// =============================================================================
// RATE CALCULATIONS
// =============================================================================

/**
 * Calculate estimated borrow rate for a reserve
 * @param reserve - The reserve
 * @param recentSlotDurationMs - Recent slot duration (optional; ignored for TrueApr reserves)
 * @returns Borrow rate as decimal (e.g., 0.05 = 5%)
 */
export function calculateKaminoEstimatedBorrowRate(
  reserve: KaminoReserve,
  recentSlotDurationMs: number = DEFAULT_RECENT_SLOT_DURATION_MS
): number {
  const { multiplier } = getKaminoRateBasis(reserve, recentSlotDurationMs);
  const currentUtilization = calculateUtilizationRatio(reserve);
  const curve = truncateBorrowCurve(reserve.config.borrowRateCurve.points);
  return getKaminoBorrowRate(currentUtilization, curve) * multiplier;
}

/**
 * Calculate estimated supply rate for a reserve
 * Formula: borrow rate × utilization × (1 - protocol take rate)
 * @param reserve - The reserve
 * @param recentSlotDurationMs - Recent slot duration (optional; ignored for TrueApr reserves)
 * @returns Supply rate as decimal (e.g., 0.03 = 3%)
 */
export function calculateKaminoEstimatedSupplyRate(
  reserve: KaminoReserve,
  recentSlotDurationMs: number = DEFAULT_RECENT_SLOT_DURATION_MS
): number {
  const borrowRate = calculateKaminoEstimatedBorrowRate(reserve, recentSlotDurationMs);
  const currentUtilization = calculateUtilizationRatio(reserve);
  const protocolTakeRatePct = 1 - reserve.config.protocolTakeRatePct / 100;

  return borrowRate * currentUtilization * protocolTakeRatePct;
}

/**
 * Calculate supply APY for a reserve
 * APY includes compounding, making it higher than APR
 * Matches Kamino SDK's reserve.totalSupplyAPY()
 * @param reserve - The Kamino reserve
 * @param recentSlotDurationMs - Recent slot duration (defaults to
 *   DEFAULT_RECENT_SLOT_DURATION_MS; ignored for TrueApr reserves)
 * @returns Supply APY as decimal (e.g., 0.0512 = 5.12% APY)
 */
export function calculateKaminoSupplyAPY(
  reserve: KaminoReserve,
  recentSlotDurationMs: number = DEFAULT_RECENT_SLOT_DURATION_MS
): number {
  const { periodsPerYear } = getKaminoRateBasis(reserve, recentSlotDurationMs);
  const supplyApr = calculateKaminoEstimatedSupplyRate(reserve, recentSlotDurationMs);
  return calculateAPYFromAPR(supplyApr, periodsPerYear);
}

export function scaledSupplies(state: KaminoReserve): [Decimal, Decimal] {
  const liqMintDecimals = new Decimal(state.liquidity.mintDecimals.toString());
  const totalSupplyLamports = getKaminoTotalSupply(state);
  const mintTotalSupplyLam = new Decimal(state.collateral.mintTotalSupply.toString());

  const liqScale = new Decimal(10).pow(liqMintDecimals);
  const collScale = new Decimal(10).pow(liqMintDecimals);

  const totalSupply = totalSupplyLamports.div(liqScale);
  const totalCollateral = mintTotalSupplyLam.div(collScale);

  return [totalSupply, totalCollateral];
}

// =============================================================================
// CURVE PROCESSING
// =============================================================================

/**
 * Convert raw curve points to normalized [utilization, rate] pairs
 * Truncates curve at 100% utilization
 */
export const truncateBorrowCurve = (points: KaminoBorrowRateCurvePoint[]): [number, number][] => {
  const curve: [number, number][] = [];
  for (const { utilizationRateBps, borrowRateBps } of points) {
    curve.push([
      utilizationRateBps / ONE_HUNDRED_PCT_IN_BPS,
      borrowRateBps / ONE_HUNDRED_PCT_IN_BPS,
    ]);

    if (utilizationRateBps === ONE_HUNDRED_PCT_IN_BPS) {
      break;
    }
  }
  return curve;
};

/**
 * Get fixed host interest rate from reserve config (1:1 with Kamino SDK)
 * Source: klend-sdk/src/classes/reserve.ts line 209
 */
export function getFixedHostInterestRate(reserve: KaminoReserve): number {
  return reserve.config.hostFixedInterestRateBps / 10_000;
}

/**
 * Get protocol take rate percentage from reserve config
 */
export function getProtocolTakeRatePct(reserve: KaminoReserve): number {
  return 1 - reserve.config.protocolTakeRatePct / 100;
}

// =============================================================================
// CURVE GENERATION
// =============================================================================

/**
 * Generate complete interest rate curve for a reserve
 * Creates 101 data points from 0% to 100% utilization
 * @param curvePoints - Raw curve configuration from reserve
 * @param slotAdjustmentFactor - Rate multiplier (`calculateSlotAdjustmentFactor`;
 *   the slot adjustment for Legacy reserves, 1 for TrueApr)
 * @param fixedHostInterestRate - Fixed rate added to all borrow rates
 * @param protocolTakeRatePct - Percentage kept by depositors (1 - protocol fee)
 * @param periodsPerYear - APY compounding periods (`getKaminoRateBasis(reserve).periodsPerYear`;
 *   defaults to SLOTS_PER_YEAR)
 * @returns Array of curve points with utilization, borrow APY, and supply APY
 */
export function generateKaminoReserveCurve(
  curvePoints: KaminoBorrowRateCurvePoint[],
  slotAdjustmentFactor: number,
  fixedHostInterestRate: number,
  protocolTakeRatePct: number,
  periodsPerYear: number = SLOTS_PER_YEAR
): KlendInterestRateCurvePoint[] {
  if (curvePoints.length === 0) {
    return [];
  }

  const curve = truncateBorrowCurve(curvePoints);

  return Array.from({ length: 101 }, (_, i) => {
    const utilization = i / 100;

    // Calculate base borrow rate and add fixed host interest
    const baseBorrowRate = getKaminoBorrowRate(utilization, curve) * slotAdjustmentFactor;
    const borrowAPR = baseBorrowRate + fixedHostInterestRate;

    // Calculate supply APR (utilization × borrowAPR × protocolTakeRate)
    const supplyAPR = utilization * borrowAPR * protocolTakeRatePct;

    // Convert to APY with compounding
    const borrowAPY = calculateAPYFromAPR(borrowAPR, periodsPerYear);
    const supplyAPY = calculateAPYFromAPR(supplyAPR, periodsPerYear);

    return {
      utilization: utilization * 100,
      borrowAPY: borrowAPY * 100,
      supplyAPY: supplyAPY * 100,
    };
  });
}

/**
 * Generate the interest rate curve for a reserve, deriving the rate multiplier
 * and compounding granularity from its interest rate basis.
 * @param reserve - The Kamino reserve
 * @param recentSlotDurationMs - Recent slot duration (optional; ignored for TrueApr reserves)
 */
export function generateKaminoReserveCurveFromReserve(
  reserve: KaminoReserve,
  recentSlotDurationMs: number = DEFAULT_RECENT_SLOT_DURATION_MS
): KlendInterestRateCurvePoint[] {
  const { multiplier, periodsPerYear } = getKaminoRateBasis(reserve, recentSlotDurationMs);
  return generateKaminoReserveCurve(
    reserve.config.borrowRateCurve.points,
    multiplier,
    getFixedHostInterestRate(reserve),
    getProtocolTakeRatePct(reserve),
    periodsPerYear
  );
}
