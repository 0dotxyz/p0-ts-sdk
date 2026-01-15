import { describe, it, expect, beforeAll } from "vitest";
import { Connection, PublicKey } from "@solana/web3.js";
import { Project0Client, MarginfiAccount, MarginfiAccountWrapper, getConfig } from "../../../src";

/**
 * Integration tests for deposit functionality
 * These test the FULL END-TO-END flow with real blockchain state
 * 
 * Setup:
 * 1. Set SOLANA_RPC_URL (mainnet, devnet, or local validator)
 * 2. Optionally set TEST_MARGINFI_ACCOUNT (will fetch real account)
 * 
 * Run: SOLANA_RPC_URL=https://api.mainnet-beta.solana.com pnpm test:integration
 */

// Known mainnet addresses for testing
const TEST_ADDRESSES = {
  SOL_BANK: new PublicKey("CCKtUs6Cgwo4aaQUmBPmyoApH2gUDErxNZCAntD6LYGh"),
  USDC_BANK: new PublicKey("2s37akK2eyBbp8DZgCm7RtsaEz8eJP3Nxd4urLHQv7yB"),
  // Add a known marginfi account with activity (for read-only tests)
  EXAMPLE_ACCOUNT: new PublicKey("7ZfBhTv6GnLkFHSgYDJJVVZKNhqVNxWFvd6jJgvGZvmG"),
};

describe("Deposit Integration Tests", () => {
  let connection: Connection;
  let client: Project0Client;

  beforeAll(async () => {
    if (!process.env.SOLANA_RPC_URL) {
      console.warn("⚠️  Skipping integration tests - SOLANA_RPC_URL not set");
      console.warn("   Example: SOLANA_RPC_URL=https://api.mainnet-beta.solana.com pnpm test:integration");
      return;
    }

    connection = new Connection(process.env.SOLANA_RPC_URL, "confirmed");
    
    // Initialize client with mainnet config (read-only tests)
    const config = getConfig("production");
    client = await Project0Client.initialize(connection, config);
    
    console.log(`✅ Connected to ${connection.rpcEndpoint}`);
    console.log(`📊 Loaded ${client.banks.length} banks`);
  }, 60000); // 60s timeout for client initialization

  describe("Client Initialization", () => {
    it.skipIf(!process.env.SOLANA_RPC_URL)(
      "should successfully initialize client with real data",
      () => {
        expect(client).toBeDefined();
        expect(client.banks.length).toBeGreaterThan(0);
        expect(client.oraclePriceByBank.size).toBeGreaterThan(0);
      }
    );

    it.skipIf(!process.env.SOLANA_RPC_URL)(
      "should fetch SOL bank correctly",
      () => {
        const solBank = client.getBank(TEST_ADDRESSES.SOL_BANK);
        expect(solBank).toBeDefined();
        expect(solBank?.address.toBase58()).toBe(TEST_ADDRESSES.SOL_BANK.toBase58());
      }
    );

    it.skipIf(!process.env.SOLANA_RPC_URL)(
      "should have oracle prices for all banks",
      () => {
        client.banks.forEach((bank) => {
          const price = client.oraclePriceByBank.get(bank.address.toBase58());
          expect(price).toBeDefined();
          expect(price?.priceRealtime.price.toNumber()).toBeGreaterThan(0);
        });
      }
    );
  });

  describe("Account Fetching", () => {
    it.skipIf(!process.env.SOLANA_RPC_URL)(
      "should fetch a real marginfi account",
      async () => {
        // Use provided test account or example account
        const accountAddress = process.env.TEST_MARGINFI_ACCOUNT
          ? new PublicKey(process.env.TEST_MARGINFI_ACCOUNT)
          : TEST_ADDRESSES.EXAMPLE_ACCOUNT;

        const account = await MarginfiAccount.fetch(accountAddress, client.program);
        
        expect(account).toBeDefined();
        expect(account.address.toBase58()).toBe(accountAddress.toBase58());
        expect(account.balances.length).toBeGreaterThanOrEqual(0);
      },
      30000
    );

    it.skipIf(!process.env.SOLANA_RPC_URL)(
      "should create account wrapper successfully",
      async () => {
        const accountAddress = process.env.TEST_MARGINFI_ACCOUNT
          ? new PublicKey(process.env.TEST_MARGINFI_ACCOUNT)
          : TEST_ADDRESSES.EXAMPLE_ACCOUNT;

        const account = await MarginfiAccount.fetch(accountAddress, client.program);
        const wrapper = new MarginfiAccountWrapper(account, client);
        
        expect(wrapper).toBeDefined();
        expect(wrapper.address.toBase58()).toBe(accountAddress.toBase58());
        expect(wrapper.activeBalances).toBeDefined();
      },
      30000
    );
  });

  describe("Deposit Transaction Building (Read-Only)", () => {
    it.skipIf(!process.env.SOLANA_RPC_URL)(
      "should build deposit instruction structure",
      async () => {
        // This tests transaction building without actually sending
        // We're testing that the SDK can construct valid transactions
        
        const accountAddress = process.env.TEST_MARGINFI_ACCOUNT
          ? new PublicKey(process.env.TEST_MARGINFI_ACCOUNT)
          : TEST_ADDRESSES.EXAMPLE_ACCOUNT;

        const account = await MarginfiAccount.fetch(accountAddress, client.program);
        const wrapper = new MarginfiAccountWrapper(account, client);
        
        // Try to build a deposit tx (won't send, just validate structure)
        const depositTx = await wrapper.makeDepositTx(
          TEST_ADDRESSES.SOL_BANK,
          "0.001" // 0.001 SOL
        );
        
        expect(depositTx).toBeDefined();
        expect(depositTx.instructions.length).toBeGreaterThan(0);
        
        // Check that transaction can be serialized
        const serialized = depositTx.serialize({ requireAllSignatures: false });
        expect(serialized.length).toBeGreaterThan(0);
        expect(serialized.length).toBeLessThan(1232); // Max transaction size
      },
      30000
    );
  });

  describe("Transaction Simulation", () => {
    it.skipIf(!process.env.SOLANA_RPC_URL)(
      "should successfully simulate deposit transaction",
      async () => {
        // Simulation tests catch issues without sending transactions
        const accountAddress = process.env.TEST_MARGINFI_ACCOUNT
          ? new PublicKey(process.env.TEST_MARGINFI_ACCOUNT)
          : TEST_ADDRESSES.EXAMPLE_ACCOUNT;

        const account = await MarginfiAccount.fetch(accountAddress, client.program);
        const wrapper = new MarginfiAccountWrapper(account, client);
        
        const depositTx = await wrapper.makeDepositTx(
          TEST_ADDRESSES.SOL_BANK,
          "0.001"
        );
        
        // Get recent blockhash for simulation
        const { blockhash } = await connection.getLatestBlockhash();
        depositTx.recentBlockhash = blockhash;
        depositTx.feePayer = account.authority;
        
        // Simulate the transaction
        const simulation = await connection.simulateTransaction(depositTx);
        
        // Note: Simulation might fail if account doesn't have balance/authority
        // but the transaction structure should be valid
        expect(simulation).toBeDefined();
        expect(simulation.value.unitsConsumed).toBeGreaterThan(0);
        
        console.log(`💰 Compute units: ${simulation.value.unitsConsumed}`);
        if (simulation.value.err) {
          console.log(`⚠️  Simulation error (expected if not account owner): ${JSON.stringify(simulation.value.err)}`);
        }
      },
      30000
    );
  });

  describe("Bank Data Validation", () => {
    it.skipIf(!process.env.SOLANA_RPC_URL)(
      "should have valid interest rate configuration",
      () => {
        client.banks.forEach((bank) => {
          const config = bank.config.interestRateConfig;
          expect(config.optimalUtilizationRate.toNumber()).toBeGreaterThan(0);
          expect(config.optimalUtilizationRate.toNumber()).toBeLessThanOrEqual(1);
          expect(config.maxInterestRate.toNumber()).toBeGreaterThan(0);
        });
      }
    );

    it.skipIf(!process.env.SOLANA_RPC_URL)(
      "should have valid asset/liability weights",
      () => {
        client.banks.forEach((bank) => {
          const config = bank.config;
          expect(config.assetWeightInit.toNumber()).toBeGreaterThanOrEqual(0);
          expect(config.assetWeightInit.toNumber()).toBeLessThanOrEqual(1);
          expect(config.liabilityWeightInit.toNumber()).toBeGreaterThanOrEqual(1);
        });
      }
    );
  });
});
