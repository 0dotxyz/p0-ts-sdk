import { PublicKey } from "@solana/web3.js";
import { vi } from "vitest";
import BigNumber from "bignumber.js";

/**
 * Test fixtures for commonly used banks
 * These are based on real mainnet data but can be used for mocking
 */

export const FIXTURES = {
  // SOL Bank
  SOL_BANK: {
    address: new PublicKey("CCKtUs6Cgwo4aaQUmBPmyoApH2gUDErxNZCAntD6LYGh"),
    mint: new PublicKey("So11111111111111111111111111111111111111112"),
    mintDecimals: 9,
    group: new PublicKey("4qp6Fx6tnZkY5Wropq9wUYgtFxXKwE6viZxFHg3rdAG8"),
  },
  
  // USDC Bank
  USDC_BANK: {
    address: new PublicKey("2s37akK2eyBbp8DZgCm7RtsaEz8eJP3Nxd4urLHQv7yB"),
    mint: new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"),
    mintDecimals: 6,
    group: new PublicKey("4qp6Fx6tnZkY5Wropq9wUYgtFxXKwE6viZxFHg3rdAG8"),
  },

  // Test Account
  MARGINFI_ACCOUNT: {
    address: new PublicKey("7ZfBhTv6GnLkFHSgYDJJVVZKNhqVNxWFvd6jJgvGZvmG"),
    authority: new PublicKey("5ZWj7a1f8tWkjBESHKgrLmXshuXxqeY9SYcfbshpAqPG"),
  },
};

/**
 * Mock RPC responses for testing
 */
export const MOCK_RPC_RESPONSES = {
  getAccountInfo: {
    solBank: {
      // Mock account data for SOL bank
      data: Buffer.from("mock_bank_data"),
      executable: false,
      lamports: 1000000,
      owner: new PublicKey("MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA"),
    },
  },
  
  getBalance: {
    default: 1_000_000_000, // 1 SOL
  },
};

/**
 * Helper to create mock Connection
 */
export function createMockConnection() {
  return {
    getAccountInfo: vi.fn().mockResolvedValue(MOCK_RPC_RESPONSES.getAccountInfo.solBank),
    getBalance: vi.fn().mockResolvedValue(MOCK_RPC_RESPONSES.getBalance.default),
    getLatestBlockhash: vi.fn().mockResolvedValue({
      blockhash: "EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N",
      lastValidBlockHeight: 100_000,
    }),
    getMinimumBalanceForRentExemption: vi.fn().mockResolvedValue(890880),
    rpcEndpoint: "http://localhost:8899",
  } as any;
}
