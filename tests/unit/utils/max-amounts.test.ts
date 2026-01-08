import { describe, it, expect } from "vitest";
import BigNumber from "bignumber.js";
import { computeMaxBorrowForBank, computeMaxWithdrawForBank } from "../../../src/services/account/utils/max-amounts.utils";
import { RiskTier } from "../../../src";
import {
  createHealthyAccountScenario,
  createAccountWithBorrowsScenario,
  TEST_ADDRESSES,
} from "../../fixtures/accounts.fixture";

/**
 * Unit tests for max amount calculations
 * 
 * These test the CORE BUSINESS LOGIC of the SDK:
 * - How much can a user borrow given their collateral?
 * - How much can a user withdraw without getting liquidated?
 * 
 * No blockchain calls needed - just math!
 */
describe("Max Amount Calculations", () => {
  describe("computeMaxBorrowForBank", () => {
    it("should compute max borrow with healthy collateral", () => {
      // Arrange
      const { account, banks, oraclePrices, usdcBank } = createHealthyAccountScenario();
      
      // Account has 10 SOL @ $150 = $1,500 collateral
      // With 75% LTV, can borrow up to $1,125
      // At $1/USDC, can borrow ~1,125 USDC
      
      // Act
      const maxBorrow = computeMaxBorrowForBank(
        account,
        banks,
        oraclePrices,
        TEST_ADDRESSES.USDC_BANK
      );
      
      // Assert
      expect(maxBorrow.toNumber()).toBeGreaterThan(1000); // At least $1,000
      expect(maxBorrow.toNumber()).toBeLessThan(1200); // But less than $1,200 (75% of $1,500)
    });

    it("should return 0 for isolated assets with existing debt", () => {
      // Arrange
      const { account, banks, oraclePrices } = createAccountWithBorrowsScenario();
      
      // Add an isolated tier bank
      const isolatedBank = {
        ...banks.get(TEST_ADDRESSES.USDT_BANK.toBase58())!,
        config: {
          ...banks.get(TEST_ADDRESSES.USDT_BANK.toBase58())!.config,
          riskTier: RiskTier.Isolated,
        },
      };
      
      banks.set(TEST_ADDRESSES.USDT_BANK.toBase58(), isolatedBank);
      oraclePrices.set(TEST_ADDRESSES.USDT_BANK.toBase58(), {
        priceRealtime: {
          price: new BigNumber(1),
          confidence: new BigNumber(0.01),
          lowestPrice: new BigNumber(0.99),
          highestPrice: new BigNumber(1.01),
        },
        priceWeighted: {
          price: new BigNumber(1),
          confidence: new BigNumber(0.01),
          lowestPrice: new BigNumber(0.99),
          highestPrice: new BigNumber(1.01),
        },
        timestamp: new BigNumber(Date.now() / 1000),
      });
      
      // Act
      const maxBorrow = computeMaxBorrowForBank(
        account,
        banks,
        oraclePrices,
        TEST_ADDRESSES.USDT_BANK
      );
      
      // Assert
      // Cannot borrow isolated asset when other debts exist
      expect(maxBorrow.toNumber()).toBe(0);
    });

    it("should throw error when bank not found", () => {
      // Arrange
      const { account, banks, oraclePrices } = createHealthyAccountScenario();
      const fakeBankAddress = TEST_ADDRESSES.USDT_BANK;
      
      // Act & Assert
      expect(() =>
        computeMaxBorrowForBank(account, banks, oraclePrices, fakeBankAddress)
      ).toThrow(/not found/);
    });

    it("should apply volatility factor correctly", () => {
      // Arrange
      const { account, banks, oraclePrices } = createHealthyAccountScenario();
      
      // Act
      const maxBorrowNormal = computeMaxBorrowForBank(
        account,
        banks,
        oraclePrices,
        TEST_ADDRESSES.USDC_BANK
      );
      
      const maxBorrowWithVolatility = computeMaxBorrowForBank(
        account,
        banks,
        oraclePrices,
        TEST_ADDRESSES.USDC_BANK,
        { volatilityFactor: 0.95 } // 5% buffer
      );
      
      // Assert
      // With volatility factor, should be able to borrow less (more conservative)
      expect(maxBorrowWithVolatility.toNumber()).toBeLessThan(
        maxBorrowNormal.toNumber()
      );
    });
  });

  describe("computeMaxWithdrawForBank", () => {
    it("should allow full withdrawal when no debt", () => {
      // Arrange
      const { account, banks, oraclePrices } = createHealthyAccountScenario();
      
      // Act
      const maxWithdraw = computeMaxWithdrawForBank(
        account,
        banks,
        oraclePrices,
        TEST_ADDRESSES.SOL_BANK
      );
      
      // Assert
      // Has 10 SOL, no debt, should be able to withdraw all
      expect(maxWithdraw.toNumber()).toBeCloseTo(10, 1);
    });

    it("should limit withdrawal when debt exists", () => {
      // Arrange
      const { account, banks, oraclePrices } = createAccountWithBorrowsScenario();
      
      // Account has 20 SOL @ $150 = $3,000
      // Borrowed 1000 USDC @ $1 = $1,000
      // With 75% LTV, must keep enough collateral
      // Required collateral: $1,000 / 0.75 = ~$1,333
      // Can withdraw: $3,000 - $1,333 = $1,667 worth
      // At $150/SOL = ~11 SOL can withdraw
      
      // Act
      const maxWithdraw = computeMaxWithdrawForBank(
        account,
        banks,
        oraclePrices,
        TEST_ADDRESSES.SOL_BANK
      );
      
      // Assert
      expect(maxWithdraw.toNumber()).toBeGreaterThan(9); // At least 9 SOL
      expect(maxWithdraw.toNumber()).toBeLessThan(20); // But not all 20 SOL
    });

    it("should return 0 for isolated bank with debt", () => {
      // Arrange
      const { account, banks, oraclePrices, solBank } = createAccountWithBorrowsScenario();
      
      // Make SOL bank isolated
      const isolatedSolBank = {
        ...solBank,
        config: {
          ...solBank.config,
          riskTier: RiskTier.Isolated,
          assetWeightInit: new BigNumber(0), // Isolated = 0 weight
          assetWeightMaint: new BigNumber(0),
        },
      };
      
      banks.set(TEST_ADDRESSES.SOL_BANK.toBase58(), isolatedSolBank);
      
      // Act
      const maxWithdraw = computeMaxWithdrawForBank(
        account,
        banks,
        oraclePrices,
        TEST_ADDRESSES.SOL_BANK
      );
      
      // Assert
      // Isolated asset with active debt = cannot withdraw
      expect(maxWithdraw.toNumber()).toBe(0);
    });

    it("should apply volatility factor for conservative withdrawals", () => {
      // Arrange
      const { account, banks, oraclePrices } = createAccountWithBorrowsScenario();
      
      // Act
      const maxWithdrawNormal = computeMaxWithdrawForBank(
        account,
        banks,
        oraclePrices,
        TEST_ADDRESSES.SOL_BANK
      );
      
      const maxWithdrawConservative = computeMaxWithdrawForBank(
        account,
        banks,
        oraclePrices,
        TEST_ADDRESSES.SOL_BANK,
        { volatilityFactor: 0.95 }
      );
      
      // Assert
      // Conservative mode should allow less withdrawal
      expect(maxWithdrawConservative.toNumber()).toBeLessThan(
        maxWithdrawNormal.toNumber()
      );
    });
  });

  describe("Edge Cases", () => {
    it("should handle zero asset weights correctly", () => {
      // Test banks with 0 asset weights (e.g., deprecated collateral)
      const { account, banks, oraclePrices, solBank } = createHealthyAccountScenario();
      
      const zeroWeightBank = {
        ...solBank,
        config: {
          ...solBank.config,
          assetWeightInit: new BigNumber(0),
          assetWeightMaint: new BigNumber(0.5), // Maintenance still > 0
        },
      };
      
      banks.set(TEST_ADDRESSES.SOL_BANK.toBase58(), zeroWeightBank);
      
      // Should still compute correctly
      const maxBorrow = computeMaxBorrowForBank(
        account,
        banks,
        oraclePrices,
        TEST_ADDRESSES.USDC_BANK
      );
      
      expect(maxBorrow.toNumber()).toBeGreaterThanOrEqual(0);
    });

    it("should handle very small amounts (dust)", () => {
      const { account, banks, oraclePrices } = createHealthyAccountScenario();
      
      // Account with tiny balance
      account.balances[0]!.assetShares = new BigNumber(1000); // 0.000001 SOL
      
      const maxBorrow = computeMaxBorrowForBank(
        account,
        banks,
        oraclePrices,
        TEST_ADDRESSES.USDC_BANK
      );
      
      expect(maxBorrow.toNumber()).toBeLessThan(1); // Less than $1
    });
  });
});
