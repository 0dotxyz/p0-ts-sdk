import { BN } from "@coral-xyz/anchor";
import {
  DriftSpotBalanceType,
  DriftSpotMarket,
  isSpotBalanceTypeVariant,
} from "../types";

/**
 * All-in-one APY/APR calculation module for Drift Protocol
 *
 * This file contains:
 * - Constants
 * - Core rate calculations (APR)
 * - APY calculations (with compounding)
 */

// ============================================================================
// CONSTANTS
// ============================================================================

export const ZERO = new BN(0);
export const ONE = new BN(1);
export const TEN = new BN(10);

// Precision constants
export const PERCENTAGE_PRECISION_EXP = new BN(6);
export const PERCENTAGE_PRECISION = new BN(10).pow(PERCENTAGE_PRECISION_EXP);

export const SPOT_MARKET_RATE_PRECISION_EXP = new BN(6);
export const SPOT_MARKET_RATE_PRECISION = new BN(10).pow(
  SPOT_MARKET_RATE_PRECISION_EXP
);

export const SPOT_MARKET_UTILIZATION_PRECISION_EXP = new BN(6);
export const SPOT_MARKET_UTILIZATION_PRECISION = new BN(10).pow(
  SPOT_MARKET_UTILIZATION_PRECISION_EXP
);

// Time constants
export const ONE_YEAR = new BN(31536000); // seconds in a year

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Ceiling division helper
 */
function divCeil(a: BN, b: BN): BN {
  const quotient = a.div(b);
  const remainder = a.mod(b);
  if (remainder.gt(ZERO)) {
    return quotient.add(ONE);
  }
  return quotient;
}

/**
 * Calculates the spot token amount including any accumulated interest.
 */
export function getTokenAmount(
  balanceAmount: BN,
  spotMarket: DriftSpotMarket,
  balanceType: DriftSpotBalanceType
): BN {
  const precisionDecrease = TEN.pow(new BN(19 - spotMarket.decimals));

  if (isSpotBalanceTypeVariant(balanceType, "deposit")) {
    return balanceAmount
      .mul(spotMarket.cumulativeDepositInterest)
      .div(precisionDecrease);
  } else {
    // For borrows, use ceiling division
    return divCeil(
      balanceAmount.mul(spotMarket.cumulativeBorrowInterest),
      precisionDecrease
    );
  }
}

// ============================================================================
// CORE RATE CALCULATIONS (APR)
// ============================================================================

/**
 * Calculates the utilization rate of a spot market
 * Utilization = borrows / deposits
 */
export function calculateUtilization(
  bank: DriftSpotMarket,
  delta: BN = ZERO
): BN {
  let tokenDepositAmount = getTokenAmount(
    bank.depositBalance,
    bank,
    DriftSpotBalanceType.DEPOSIT
  );
  let tokenBorrowAmount = getTokenAmount(
    bank.borrowBalance,
    bank,
    DriftSpotBalanceType.BORROW
  );

  if (delta.gt(ZERO)) {
    tokenDepositAmount = tokenDepositAmount.add(delta);
  } else if (delta.lt(ZERO)) {
    tokenBorrowAmount = tokenBorrowAmount.add(delta.abs());
  }

  let utilization: BN;
  if (tokenBorrowAmount.eq(ZERO) && tokenDepositAmount.eq(ZERO)) {
    utilization = ZERO;
  } else if (tokenDepositAmount.eq(ZERO)) {
    utilization = SPOT_MARKET_UTILIZATION_PRECISION;
  } else {
    utilization = tokenBorrowAmount
      .mul(SPOT_MARKET_UTILIZATION_PRECISION)
      .div(tokenDepositAmount);
  }

  return utilization;
}

/**
 * Calculates the interest rate based on utilization using a piecewise curve
 */
export function calculateInterestRate(
  bank: DriftSpotMarket,
  delta: BN = ZERO,
  currentUtilization: BN | null = null
): BN {
  const utilization = currentUtilization || calculateUtilization(bank, delta);

  const optimalUtil = new BN(bank.optimalUtilization);
  const optimalRate = new BN(bank.optimalBorrowRate);
  const maxRate = new BN(bank.maxBorrowRate);
  const minRate = new BN(bank.minBorrowRate).mul(
    PERCENTAGE_PRECISION.divn(200)
  );

  const weightsDivisor = new BN(1000);
  const segments: [BN, BN][] = [
    [new BN(850_000), new BN(50)],
    [new BN(900_000), new BN(100)],
    [new BN(950_000), new BN(150)],
    [new BN(990_000), new BN(200)],
    [new BN(995_000), new BN(250)],
    [SPOT_MARKET_UTILIZATION_PRECISION, new BN(250)],
  ];

  let rate: BN;
  if (utilization.lte(optimalUtil)) {
    // below optimal: linear ramp from 0 to optimalRate
    const slope = optimalRate
      .mul(SPOT_MARKET_UTILIZATION_PRECISION)
      .div(optimalUtil);
    rate = utilization.mul(slope).div(SPOT_MARKET_UTILIZATION_PRECISION);
  } else {
    // above optimal: piecewise segments
    const totalExtraRate = maxRate.sub(optimalRate);

    rate = optimalRate.clone();
    let prevUtil = optimalUtil.clone();

    for (const [bp, weight] of segments) {
      const segmentEnd = bp.gt(SPOT_MARKET_UTILIZATION_PRECISION)
        ? SPOT_MARKET_UTILIZATION_PRECISION
        : bp;
      const segmentRange = segmentEnd.sub(prevUtil);

      const segmentRateTotal = totalExtraRate.mul(weight).div(weightsDivisor);

      if (utilization.lte(segmentEnd)) {
        const partialUtil = utilization.sub(prevUtil);
        const partialRate = segmentRateTotal.mul(partialUtil).div(segmentRange);
        rate = rate.add(partialRate);
        break;
      } else {
        rate = rate.add(segmentRateTotal);
        prevUtil = segmentEnd;
      }
    }
  }

  return BN.max(minRate, rate);
}

/**
 * Calculates the borrow rate (APR) for a spot market
 */
export function calculateBorrowRate(
  bank: DriftSpotMarket,
  delta: BN = ZERO,
  currentUtilization: BN | null = null
): BN {
  return calculateInterestRate(bank, delta, currentUtilization);
}

/**
 * Calculates the deposit rate (APR) for a spot market
 * This is the annualized interest rate lenders earn
 */
export function calculateDepositRate(
  bank: DriftSpotMarket,
  delta: BN = ZERO,
  currentUtilization: BN | null = null
): BN {
  // positive delta => adding to deposit
  // negative delta => adding to borrow

  const utilization = currentUtilization || calculateUtilization(bank, delta);
  const borrowRate = calculateBorrowRate(bank, delta, utilization);
  const depositRate = borrowRate
    .mul(PERCENTAGE_PRECISION.sub(new BN(bank.insuranceFund.totalFactor)))
    .mul(utilization)
    .div(SPOT_MARKET_UTILIZATION_PRECISION)
    .div(PERCENTAGE_PRECISION);
  return depositRate;
}

// ============================================================================
// APY CALCULATIONS (WITH COMPOUNDING)
// ============================================================================

/**
 * Calculates the Annual Percentage Yield (APY) for a lending/deposit position.
 *
 * APY accounts for compounding effects, unlike the simple deposit rate (APR).
 *
 * Formula: APY = e^(rate) - 1 (for continuous compounding approximation)
 *
 * @param bank - The SpotMarketAccount for the market
 * @param delta - Optional delta to simulate a deposit/borrow change (default: ZERO)
 * @param currentUtilization - Optional pre-calculated utilization (default: null, will be calculated)
 * @param compoundingPeriodsPerYear - Number of times interest compounds per year (default: 365 for daily)
 * @returns APY as a percentage scaled by PERCENTAGE_PRECISION (e.g., 5% = 5_000_000)
 *
 * @example
 * ```typescript
 * const bank = driftClient.getSpotMarketAccount(0); // USDC
 * const apy = calculateLendingAPY(bank);
 * const apyPercent = apy.toNumber() / PERCENTAGE_PRECISION.toNumber(); // Convert to decimal
 * console.log(`Lending APY: ${apyPercent.toFixed(2)}%`);
 * ```
 */
export function calculateLendingAPY(
  bank: DriftSpotMarket,
  delta: BN = ZERO,
  currentUtilization: BN | null = null,
  compoundingPeriodsPerYear: number = 365
): BN {
  // Get the annualized deposit rate (APR)
  const depositRate = calculateDepositRate(bank, delta, currentUtilization);

  if (depositRate.eq(ZERO)) {
    return ZERO;
  }

  // Calculate e^r using Taylor series expansion
  // e^r = 1 + r + r^2/2! + r^3/3! + r^4/4! + r^5/5! + r^6/6! + r^7/7! + r^8/8!
  const CALC_PRECISION = new BN(10).pow(new BN(18));

  const rateInCalcPrecisionDecimal = depositRate
    .mul(CALC_PRECISION)
    .div(SPOT_MARKET_RATE_PRECISION);

  // Calculate terms of Taylor series (first 8 terms for accuracy)
  let expResult = CALC_PRECISION; // Start with 1
  let term = rateInCalcPrecisionDecimal; // First term is r

  // Add r
  expResult = expResult.add(term);

  // Add r^2/2!
  term = term.mul(rateInCalcPrecisionDecimal).div(CALC_PRECISION).divn(2);
  expResult = expResult.add(term);

  // Add r^3/3!
  term = term.mul(rateInCalcPrecisionDecimal).div(CALC_PRECISION).divn(3);
  expResult = expResult.add(term);

  // Add r^4/4!
  term = term.mul(rateInCalcPrecisionDecimal).div(CALC_PRECISION).divn(4);
  expResult = expResult.add(term);

  // Add r^5/5!
  term = term.mul(rateInCalcPrecisionDecimal).div(CALC_PRECISION).divn(5);
  expResult = expResult.add(term);

  // Add r^6/6!
  term = term.mul(rateInCalcPrecisionDecimal).div(CALC_PRECISION).divn(6);
  expResult = expResult.add(term);

  // Add r^7/7!
  term = term.mul(rateInCalcPrecisionDecimal).div(CALC_PRECISION).divn(7);
  expResult = expResult.add(term);

  // Add r^8/8!
  term = term.mul(rateInCalcPrecisionDecimal).div(CALC_PRECISION).divn(8);
  expResult = expResult.add(term);

  // APY = e^r - 1
  const apyInCalcPrecision = expResult.sub(CALC_PRECISION);

  // Convert back to PERCENTAGE_PRECISION
  const apy = apyInCalcPrecision.mul(PERCENTAGE_PRECISION).div(CALC_PRECISION);

  return apy;
}

/**
 * Calculates a simplified lending APY without compounding (essentially the APR).
 * This is faster but less accurate than calculateLendingAPY.
 *
 * @param bank - The SpotMarketAccount for the market
 * @param delta - Optional delta to simulate a deposit/borrow change (default: ZERO)
 * @param currentUtilization - Optional pre-calculated utilization (default: null)
 * @returns APR as a percentage scaled by PERCENTAGE_PRECISION
 */
export function calculateLendingAPR(
  bank: DriftSpotMarket,
  delta: BN = ZERO,
  currentUtilization: BN | null = null
): BN {
  const depositRate = calculateDepositRate(bank, delta, currentUtilization);

  // Convert from SPOT_MARKET_RATE_PRECISION to PERCENTAGE_PRECISION
  // depositRate is already annualized, just need to convert precision
  const apr = depositRate
    .mul(PERCENTAGE_PRECISION)
    .div(SPOT_MARKET_RATE_PRECISION);

  return apr;
}

/**
 * Calculates the borrowing APY for a borrow position.
 *
 * @param bank - The SpotMarketAccount for the market
 * @param delta - Optional delta to simulate a deposit/borrow change (default: ZERO)
 * @param currentUtilization - Optional pre-calculated utilization (default: null)
 * @param compoundingPeriodsPerYear - Number of times interest compounds per year (default: 365)
 * @returns APY as a percentage scaled by PERCENTAGE_PRECISION
 */
export function calculateBorrowAPY(
  bank: DriftSpotMarket,
  delta: BN = ZERO,
  currentUtilization: BN | null = null,
  compoundingPeriodsPerYear: number = 365
): BN {
  const borrowRate = calculateBorrowRate(bank, delta, currentUtilization);

  if (borrowRate.eq(ZERO)) {
    return ZERO;
  }

  // Same logic as lending APY but using borrow rate
  const CALC_PRECISION = new BN(10).pow(new BN(18));

  const rateInCalcPrecisionDecimal = borrowRate
    .mul(CALC_PRECISION)
    .div(SPOT_MARKET_RATE_PRECISION);

  let expResult = CALC_PRECISION;
  let term = rateInCalcPrecisionDecimal;

  expResult = expResult.add(term);
  term = term.mul(rateInCalcPrecisionDecimal).div(CALC_PRECISION).divn(2);
  expResult = expResult.add(term);
  term = term.mul(rateInCalcPrecisionDecimal).div(CALC_PRECISION).divn(3);
  expResult = expResult.add(term);
  term = term.mul(rateInCalcPrecisionDecimal).div(CALC_PRECISION).divn(4);
  expResult = expResult.add(term);
  term = term.mul(rateInCalcPrecisionDecimal).div(CALC_PRECISION).divn(5);
  expResult = expResult.add(term);
  term = term.mul(rateInCalcPrecisionDecimal).div(CALC_PRECISION).divn(6);
  expResult = expResult.add(term);
  term = term.mul(rateInCalcPrecisionDecimal).div(CALC_PRECISION).divn(7);
  expResult = expResult.add(term);
  term = term.mul(rateInCalcPrecisionDecimal).div(CALC_PRECISION).divn(8);
  expResult = expResult.add(term);

  const apyInCalcPrecision = expResult.sub(CALC_PRECISION);

  const apy = apyInCalcPrecision.mul(PERCENTAGE_PRECISION).div(CALC_PRECISION);

  return apy;
}

/**
 * Calculates the borrowing APR (without compounding).
 *
 * @param bank - The SpotMarketAccount for the market
 * @param delta - Optional delta to simulate a deposit/borrow change (default: ZERO)
 * @param currentUtilization - Optional pre-calculated utilization (default: null)
 * @returns APR as a percentage scaled by PERCENTAGE_PRECISION
 */
export function calculateBorrowAPR(
  bank: DriftSpotMarket,
  delta: BN = ZERO,
  currentUtilization: BN | null = null
): BN {
  const borrowRate = calculateBorrowRate(bank, delta, currentUtilization);

  // Convert from SPOT_MARKET_RATE_PRECISION to PERCENTAGE_PRECISION
  const apr = borrowRate
    .mul(PERCENTAGE_PRECISION)
    .div(SPOT_MARKET_RATE_PRECISION);

  return apr;
}
