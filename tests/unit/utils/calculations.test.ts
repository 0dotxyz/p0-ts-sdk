import { describe, it, expect } from "vitest";
import BigNumber from "bignumber.js";

/**
 * Unit tests for PURE calculation functions
 * These have no dependencies and are easy to test
 */

describe("Pure Calculations", () => {
  describe("Price Calculations", () => {
    it("should calculate weighted price correctly", () => {
      const price = new BigNumber(100);
      const assetWeight = new BigNumber(0.75);
      
      const weightedPrice = price.times(assetWeight);
      
      expect(weightedPrice.toNumber()).toBe(75);
    });

    it("should apply price bias correctly", () => {
      const basePrice = new BigNumber(100);
      const confidence = new BigNumber(1); // ±$1
      
      const lowestPrice = basePrice.minus(confidence);
      const highestPrice = basePrice.plus(confidence);
      
      expect(lowestPrice.toNumber()).toBe(99);
      expect(highestPrice.toNumber()).toBe(101);
    });
  });

  describe("Collateral Calculations", () => {
    it("should calculate asset value correctly", () => {
      const assetAmount = new BigNumber(10); // 10 SOL
      const price = new BigNumber(150); // $150/SOL
      const assetWeight = new BigNumber(0.75); // 75% LTV
      
      const collateralValue = assetAmount.times(price).times(assetWeight);
      
      expect(collateralValue.toNumber()).toBe(1125); // $1,125
    });

    it("should calculate liability value correctly", () => {
      const liabilityAmount = new BigNumber(1000); // 1000 USDC borrowed
      const price = new BigNumber(1); // $1/USDC
      const liabilityWeight = new BigNumber(1.25); // 125% borrow weight
      
      const debtValue = liabilityAmount.times(price).times(liabilityWeight);
      
      expect(debtValue.toNumber()).toBe(1250); // $1,250 weighted debt
    });
  });

  describe("Health Factor", () => {
    it("should compute health factor correctly", () => {
      const totalAssets = new BigNumber(1500); // $1,500 collateral
      const totalLiabilities = new BigNumber(750); // $750 debt
      
      const healthFactor = totalAssets.div(totalLiabilities);
      
      expect(healthFactor.toNumber()).toBe(2); // 200% health
    });

    it("should identify healthy positions", () => {
      const assets = new BigNumber(2000);
      const liabilities = new BigNumber(1000);
      const liquidationThreshold = new BigNumber(1.25); // 125%
      
      const healthFactor = assets.div(liabilities);
      const isHealthy = healthFactor.gte(liquidationThreshold);
      
      expect(isHealthy).toBe(true);
    });

    it("should identify unhealthy positions", () => {
      const assets = new BigNumber(1200);
      const liabilities = new BigNumber(1000);
      const liquidationThreshold = new BigNumber(1.25);
      
      const healthFactor = assets.div(liabilities);
      const isHealthy = healthFactor.gte(liquidationThreshold);
      
      expect(isHealthy).toBe(false); // 1.2 < 1.25 = underwater
    });

    it("should handle zero debt correctly", () => {
      const assets = new BigNumber(1000);
      const liabilities = new BigNumber(0);
      
      const healthFactor = liabilities.isZero() 
        ? Infinity 
        : assets.div(liabilities);
      
      expect(healthFactor).toBe(Infinity);
    });
  });

  describe("Interest Rate Calculations", () => {
    it("should calculate utilization rate", () => {
      const totalBorrowed = new BigNumber(800);
      const totalDeposited = new BigNumber(1000);
      
      const utilization = totalBorrowed.div(totalDeposited);
      
      expect(utilization.toNumber()).toBe(0.8); // 80%
    });

    it("should handle 0% utilization", () => {
      const totalBorrowed = new BigNumber(0);
      const totalDeposited = new BigNumber(1000);
      
      const utilization = totalBorrowed.div(totalDeposited);
      
      expect(utilization.toNumber()).toBe(0);
    });

    it("should handle 100% utilization", () => {
      const totalBorrowed = new BigNumber(1000);
      const totalDeposited = new BigNumber(1000);
      
      const utilization = totalBorrowed.div(totalDeposited);
      
      expect(utilization.toNumber()).toBe(1);
    });
  });

  describe("Amount Conversions", () => {
    it("should convert UI to native (SOL)", () => {
      const uiAmount = new BigNumber(1.5);
      const decimals = 9;
      
      const native = uiAmount.times(new BigNumber(10).pow(decimals));
      
      expect(native.toString()).toBe("1500000000");
    });

    it("should convert native to UI (USDC)", () => {
      const nativeAmount = new BigNumber(100_500_000);
      const decimals = 6;
      
      const ui = nativeAmount.div(new BigNumber(10).pow(decimals));
      
      expect(ui.toNumber()).toBe(100.5);
    });

    it("should handle very small amounts", () => {
      const nativeAmount = new BigNumber(1); // 1 lamport
      const decimals = 9;
      
      const ui = nativeAmount.div(new BigNumber(10).pow(decimals));
      
      expect(ui.toNumber()).toBe(0.000000001);
    });
  });
});
