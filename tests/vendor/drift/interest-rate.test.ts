import { getAddressDecoder } from "@solana/kit";
import { describe, expect, it } from "vitest";

import {
  calculateDriftBorrowAPR,
  calculateDriftBorrowAPY,
  calculateDriftLendingAPR,
  calculateDriftLendingAPY,
  calculateDriftUtilization,
  getDriftTokenAmount,
  SpotBalanceType,
  type DriftSpotMarket,
} from "~/vendor/drift";

// Values match the pre-Kit BN implementation (checked on mainnet spot markets 0–5 and 1000 random
// markets during the migration).

const key = (fill: number) => getAddressDecoder().decode(new Uint8Array(32).fill(fill));

const market: DriftSpotMarket = {
  pubkey: key(1),
  oracle: key(2),
  mint: key(3),
  decimals: 6,
  marketIndex: 0,
  cumulativeDepositInterest: 11_234_567_890n,
  cumulativeBorrowInterest: 12_345_678_901n,
  depositBalance: 500_000_000_000_000n,
  borrowBalance: 410_000_000_000_000n,
  optimalUtilization: 800_000,
  optimalBorrowRate: 90_000,
  maxBorrowRate: 1_500_000,
  minBorrowRate: 2,
  insuranceFund: { totalFactor: 100_000 },
  poolId: 0,
};

describe("drift interest rates", () => {
  it("token amounts round deposits down and borrows up", () => {
    expect(getDriftTokenAmount(3n, market, SpotBalanceType.Deposit)).toBe(0n);
    expect(getDriftTokenAmount(3n, market, SpotBalanceType.Borrow)).toBe(1n);
  });

  it("matches recorded rates", () => {
    expect({
      utilization: calculateDriftUtilization(market),
      utilizationWithDeposit: calculateDriftUtilization(market, 1_000_000_000n),
      utilizationWithBorrow: calculateDriftUtilization(market, -1_000_000_000n),
      lendingApr: calculateDriftLendingAPR(market),
      lendingApy: calculateDriftLendingAPY(market),
      borrowApr: calculateDriftBorrowAPR(market),
      borrowApy: calculateDriftBorrowAPY(market),
      borrowAprAtZeroUtilization: calculateDriftBorrowAPR(market, 0n, 0n),
      borrowAprAt99: calculateDriftBorrowAPR(market, 0n, 990_000n),
    }).toMatchSnapshot();
  });
});
