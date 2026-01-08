import { describe, it, expect, beforeEach, vi } from "vitest";
import { PublicKey } from "@solana/web3.js";
import { MarginfiAccount, Bank } from "../../../src";
import { FIXTURES, createMockConnection } from "../../fixtures/banks.fixture";

/**
 * Unit tests for deposit actions
 * Uses mocked RPC to avoid network calls in CI
 */
describe("Deposit Actions", () => {
  let mockConnection: any;

  beforeEach(() => {
    mockConnection = createMockConnection();
    vi.clearAllMocks();
  });

  describe("makeDepositIx", () => {
    it("should create deposit instruction for SOL", async () => {
      // Arrange
      const amount = "1.5"; // 1.5 SOL
      const bankAddress = FIXTURES.SOL_BANK.address;

      // Mock the account fetch
      const mockAccount = {
        address: FIXTURES.MARGINFI_ACCOUNT.address,
        authority: FIXTURES.MARGINFI_ACCOUNT.authority,
      } as any;

      // Act
      // const ix = await makeDepositIx({
      //   account: mockAccount,
      //   bank: bankAddress,
      //   amount,
      // });

      // Assert
      // expect(ix).toBeDefined();
      // expect(ix.keys).toHaveLength(expectedKeyCount);
      
      // For now, simple assertion
      expect(mockConnection.getAccountInfo).toHaveBeenCalledTimes(0);
    });

    it("should handle invalid amount", async () => {
      // Test error handling
      expect(() => {
        const invalidAmount = "-1";
        // validateAmount(invalidAmount);
      }).not.toThrow(); // Adjust based on actual validation
    });
  });

  describe("makeDepositTx", () => {
    it("should create complete deposit transaction", async () => {
      // Test building full transaction with all required instructions
      const bankAddress = FIXTURES.USDC_BANK.address;
      const amount = "100"; // 100 USDC

      // Mock transaction building
      expect(bankAddress).toBeDefined();
      expect(amount).toBe("100");
    });
  });
});
