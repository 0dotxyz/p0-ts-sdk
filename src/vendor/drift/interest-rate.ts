import type { DriftSpotMarket } from "./types";

import { SpotBalanceType } from "~/generated/drift";

export const PERCENTAGE_PRECISION = 1_000_000n;
export const SPOT_MARKET_RATE_PRECISION = 1_000_000n;
export const SPOT_MARKET_UTILIZATION_PRECISION = 1_000_000n;
/** Seconds */
export const ONE_YEAR = 31_536_000n;

/**
 * Token amount (native units) of a scaled spot balance, including accrued interest. Borrows round up.
 */
export function getDriftTokenAmount(
  balanceAmount: bigint,
  spotMarket: DriftSpotMarket,
  balanceType: SpotBalanceType
): bigint {
  const precisionDecrease = 10n ** BigInt(19 - spotMarket.decimals);

  if (balanceType === SpotBalanceType.Deposit) {
    return (balanceAmount * spotMarket.cumulativeDepositInterest) / precisionDecrease;
  }
  const scaled = balanceAmount * spotMarket.cumulativeBorrowInterest;
  const quotient = scaled / precisionDecrease;
  return scaled % precisionDecrease > 0n ? quotient + 1n : quotient;
}

/**
 * Utilization (SPOT_MARKET_UTILIZATION_PRECISION) = borrows / deposits. A positive `delta` adds to
 * deposits, a negative one to borrows (native units).
 */
export function calculateDriftUtilization(bank: DriftSpotMarket, delta: bigint = 0n): bigint {
  let deposits = getDriftTokenAmount(bank.depositBalance, bank, SpotBalanceType.Deposit);
  let borrows = getDriftTokenAmount(bank.borrowBalance, bank, SpotBalanceType.Borrow);

  if (delta > 0n) {
    deposits += delta;
  } else if (delta < 0n) {
    borrows -= delta;
  }

  if (borrows === 0n && deposits === 0n) {
    return 0n;
  }
  if (deposits === 0n) {
    return SPOT_MARKET_UTILIZATION_PRECISION;
  }
  return (borrows * SPOT_MARKET_UTILIZATION_PRECISION) / deposits;
}

/**
 * Borrow rate (SPOT_MARKET_RATE_PRECISION) at the market's utilization: linear up to the optimal
 * utilization, then Drift's weighted segments up to the max rate, floored at the min rate.
 */
export function calculateDriftInterestRate(
  bank: DriftSpotMarket,
  delta: bigint = 0n,
  currentUtilization: bigint | null = null
): bigint {
  const utilization = currentUtilization ?? calculateDriftUtilization(bank, delta);

  const optimalUtil = BigInt(bank.optimalUtilization);
  const optimalRate = BigInt(bank.optimalBorrowRate);
  const maxRate = BigInt(bank.maxBorrowRate);
  const minRate = BigInt(bank.minBorrowRate) * (PERCENTAGE_PRECISION / 200n);

  const segments: [bigint, bigint][] = [
    [850_000n, 50n],
    [900_000n, 100n],
    [950_000n, 150n],
    [990_000n, 200n],
    [995_000n, 250n],
    [SPOT_MARKET_UTILIZATION_PRECISION, 250n],
  ];

  let rate: bigint;
  if (utilization <= optimalUtil) {
    const slope = (optimalRate * SPOT_MARKET_UTILIZATION_PRECISION) / optimalUtil;
    rate = (utilization * slope) / SPOT_MARKET_UTILIZATION_PRECISION;
  } else {
    const totalExtraRate = maxRate - optimalRate;
    rate = optimalRate;
    let prevUtil = optimalUtil;

    for (const [breakpoint, weight] of segments) {
      const segmentEnd =
        breakpoint > SPOT_MARKET_UTILIZATION_PRECISION
          ? SPOT_MARKET_UTILIZATION_PRECISION
          : breakpoint;
      const segmentRateTotal = (totalExtraRate * weight) / 1000n;

      if (utilization <= segmentEnd) {
        rate += (segmentRateTotal * (utilization - prevUtil)) / (segmentEnd - prevUtil);
        break;
      }
      rate += segmentRateTotal;
      prevUtil = segmentEnd;
    }
  }

  return rate > minRate ? rate : minRate;
}

/** Borrow APR, SPOT_MARKET_RATE_PRECISION. */
export function calculateDriftBorrowRate(
  bank: DriftSpotMarket,
  delta: bigint = 0n,
  currentUtilization: bigint | null = null
): bigint {
  return calculateDriftInterestRate(bank, delta, currentUtilization);
}

/** Deposit APR, SPOT_MARKET_RATE_PRECISION: borrow rate × utilization × (1 − insurance fund factor). */
export function calculateDriftDepositRate(
  bank: DriftSpotMarket,
  delta: bigint = 0n,
  currentUtilization: bigint | null = null
): bigint {
  const utilization = currentUtilization ?? calculateDriftUtilization(bank, delta);
  const borrowRate = calculateDriftBorrowRate(bank, delta, utilization);
  return (
    (borrowRate * (PERCENTAGE_PRECISION - BigInt(bank.insuranceFund.totalFactor)) * utilization) /
    SPOT_MARKET_UTILIZATION_PRECISION /
    PERCENTAGE_PRECISION
  );
}

// e^r − 1 by an 8-term Taylor series; rate in SPOT_MARKET_RATE_PRECISION, result in PERCENTAGE_PRECISION.
function continuousApy(rate: bigint): bigint {
  if (rate === 0n) {
    return 0n;
  }
  const precision = 10n ** 18n;
  const r = (rate * precision) / SPOT_MARKET_RATE_PRECISION;
  let term = r;
  let sum = precision + r;
  for (let n = 2n; n <= 8n; n++) {
    term = (term * r) / precision / n;
    sum += term;
  }
  return ((sum - precision) * PERCENTAGE_PRECISION) / precision;
}

/** Lending APY (continuous compounding), PERCENTAGE_PRECISION. */
export function calculateDriftLendingAPY(
  bank: DriftSpotMarket,
  delta: bigint = 0n,
  currentUtilization: bigint | null = null
): bigint {
  return continuousApy(calculateDriftDepositRate(bank, delta, currentUtilization));
}

/** Lending APR, PERCENTAGE_PRECISION. */
export function calculateDriftLendingAPR(
  bank: DriftSpotMarket,
  delta: bigint = 0n,
  currentUtilization: bigint | null = null
): bigint {
  return (
    (calculateDriftDepositRate(bank, delta, currentUtilization) * PERCENTAGE_PRECISION) /
    SPOT_MARKET_RATE_PRECISION
  );
}

/** Borrow APY (continuous compounding), PERCENTAGE_PRECISION. */
export function calculateDriftBorrowAPY(
  bank: DriftSpotMarket,
  delta: bigint = 0n,
  currentUtilization: bigint | null = null
): bigint {
  return continuousApy(calculateDriftBorrowRate(bank, delta, currentUtilization));
}

/** Borrow APR, PERCENTAGE_PRECISION. */
export function calculateDriftBorrowAPR(
  bank: DriftSpotMarket,
  delta: bigint = 0n,
  currentUtilization: bigint | null = null
): bigint {
  return (
    (calculateDriftBorrowRate(bank, delta, currentUtilization) * PERCENTAGE_PRECISION) /
    SPOT_MARKET_RATE_PRECISION
  );
}

export interface DriftInterestRateCurvePoint {
  /** Percent (0–100) */
  utilization: number;
  /** Percent */
  borrowAPY: number;
  /** Percent */
  supplyAPY: number;
}

// 2 slots/s over a 365-day year, matching the Kamino curves.
const SLOTS_PER_YEAR = 63_072_000;

/**
 * Borrow and supply APY curve of a Drift spot market at 0–100% utilization (101 points), compounded
 * per slot like the Kamino curves.
 */
export function generateDriftReserveCurve(
  spotMarket: DriftSpotMarket
): DriftInterestRateCurvePoint[] {
  const toApy = (apr: number) =>
    apr === 0 ? 0 : Math.pow(1 + apr / SLOTS_PER_YEAR, SLOTS_PER_YEAR) - 1;
  return Array.from({ length: 101 }, (_, i) => {
    const utilization = BigInt(Math.floor((i / 100) * Number(SPOT_MARKET_UTILIZATION_PRECISION)));
    const borrowApr =
      Number(calculateDriftBorrowRate(spotMarket, 0n, utilization)) /
      Number(SPOT_MARKET_RATE_PRECISION);
    const supplyApr =
      Number(calculateDriftDepositRate(spotMarket, 0n, utilization)) /
      Number(SPOT_MARKET_RATE_PRECISION);
    return {
      utilization: i,
      borrowAPY: toApy(borrowApr) * 100,
      supplyAPY: toApy(supplyApr) * 100,
    };
  });
}
