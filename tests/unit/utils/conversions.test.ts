import { describe, it, expect } from "vitest";
import BigNumber from "bignumber.js";

/**
 * Unit tests for utility functions
 * These are PERFECT for unit testing - pure functions, no blockchain needed!
 */

describe("Amount Conversions", () => {
  describe("uiToNative", () => {
    it("should convert SOL UI amount to native", () => {
      // SOL has 9 decimals
      const native = uiToNative("1.5", 9);
      expect(native.toString()).toBe("1500000000");
    });

    it("should convert USDC UI amount to native", () => {
      // USDC has 6 decimals
      const native = uiToNative("100.50", 6);
      expect(native.toString()).toBe("100500000");
    });

    it("should handle zero correctly", () => {
      const native = uiToNative("0", 9);
      expect(native.toString()).toBe("0");
    });

    it("should handle very small amounts", () => {
      const native = uiToNative("0.000000001", 9); // 1 lamport
      expect(native.toString()).toBe("1");
    });

    it("should throw on negative amounts", () => {
      expect(() => uiToNative("-1", 9)).toThrow();
    });
  });

  describe("nativeToUi", () => {
    it("should convert SOL native to UI", () => {
      const ui = nativeToUi(new BigNumber("1500000000"), 9);
      expect(ui).toBe(1.5);
    });

    it("should convert USDC native to UI", () => {
      const ui = nativeToUi(new BigNumber("100500000"), 6);
      expect(ui).toBe(100.5);
    });

    it("should handle dust amounts", () => {
      const ui = nativeToUi(new BigNumber("1"), 9);
      expect(ui).toBe(0.000000001);
    });
  });
});

describe("Interest Rate Calculations", () => {
  it("should calculate borrow APR correctly", () => {
    // Given utilization rate, calculate APR
    // This is pure math - perfect for unit testing!
    const apr = calculateBorrowApr(0.8); // 80% utilization
    expect(apr).toBeGreaterThan(0);
    expect(apr).toBeLessThan(3); // Max APR
  });

  it("should calculate lend APY correctly", () => {
    // Lend APY = Borrow APR * utilization * (1 - protocol fee)
    const apy = calculateLendApy(0.1, 0.8, 0.1); // 10% APR, 80% util, 10% fee
    expect(apy).toBeCloseTo(0.072, 3); // ~7.2%
  });
});

describe("Health Factor Calculations", () => {
  it("should compute health factor correctly", () => {
    const assets = new BigNumber(1000); // $1000 collateral
    const liabilities = new BigNumber(500); // $500 debt
    
    const healthFactor = assets.div(liabilities);
    expect(healthFactor.toNumber()).toBe(2);
  });

  it("should handle zero liabilities", () => {
    const assets = new BigNumber(1000);
    const liabilities = new BigNumber(0);
    
    const healthFactor = liabilities.isZero() ? Infinity : assets.div(liabilities);
    expect(healthFactor).toBe(Infinity);
  });

  it("should detect unhealthy positions", () => {
    const assets = new BigNumber(1000);
    const liabilities = new BigNumber(900); // 90% LTV
    const threshold = 1.25; // 125% = liquidation threshold
    
    const healthFactor = assets.div(liabilities);
    const isHealthy = healthFactor.gte(threshold);
    
    expect(isHealthy).toBe(false); // This position would be liquidated
  });
});

// Helper functions (these would come from your SDK)
function uiToNative(amount: string, decimals: number): BigNumber {
  const parsed = new BigNumber(amount);
  if (parsed.isNegative()) {
    throw new Error("Amount cannot be negative");
  }
  return parsed.times(new BigNumber(10).pow(decimals));
}

function nativeToUi(amount: BigNumber, decimals: number): number {
  return amount.div(new BigNumber(10).pow(decimals)).toNumber();
}

function calculateBorrowApr(utilization: number): number {
  // Simplified interest rate model
  const optimalUtilization = 0.8;
  const baseRate = 0.02;
  const optimalRate = 0.1;
  const maxRate = 3.0;
  
  if (utilization <= optimalUtilization) {
    return baseRate + (optimalRate - baseRate) * (utilization / optimalUtilization);
  } else {
    const excessUtil = utilization - optimalUtilization;
    return optimalRate + (maxRate - optimalRate) * (excessUtil / (1 - optimalUtilization));
  }
}

function calculateLendApy(borrowApr: number, utilization: number, protocolFee: number): number {
  return borrowApr * utilization * (1 - protocolFee);
}
