/**
 * Example: Account Health with Cache Simulation
 *
 * This example shows how to:
 * 1. Initialize the Project0Client from config
 * 2. Fetch a marginfi account
 * 3. Simulate the health cache by refreshing oracles and updating on-chain data
 * 4. Read health metrics from the simulated cache
 *
 * The simulation approach:
 * - Refreshes Kamino reserves, Drift spot markets and JupLend rates
 * - Calls the PulseHealth instruction to update the health cache
 * - Simulates the transaction and reads the updated account data
 * - Provides the most accurate, up-to-date health information
 * - Needs an RPC endpoint that supports Jito's `simulateBundle`
 *
 * Setup:
 * 1. Copy .env.example to .env
 * 2. Fill in your configuration values
 * 3. Run: tsx 06a-account-health-simulated.ts
 */

import {
  Project0Client,
  MarginfiAccountWrapper,
  MarginfiAccount,
  MarginRequirementType,
} from "../src";
import { getRpc, getMarginfiConfig, getAccountAddress } from "./config";

// ============================================================================
// Main Example
// ============================================================================

async function accountHealthSimulatedExample() {
  // --------------------------------------------------------------------------
  // Step 1: Load Configuration
  // --------------------------------------------------------------------------
  console.log("\n🔧 Loading configuration...");

  const { rpc, rpcEndpoint } = getRpc();
  const config = getMarginfiConfig();

  console.log(`   RPC: ${rpcEndpoint}`);
  console.log(`   Environment: ${config.environment}`);

  // --------------------------------------------------------------------------
  // Step 2: Initialize Project0Client
  // --------------------------------------------------------------------------
  console.log("\n📡 Initializing Project0Client...");

  const client = await Project0Client.initialize({ rpc, rpcEndpoint }, config);

  console.log(`✅ Client initialized`);
  console.log(`📊 Loaded ${client.banks.length} banks`);

  // --------------------------------------------------------------------------
  // Step 3: Load Marginfi Account
  // --------------------------------------------------------------------------
  console.log("\n👤 Loading marginfi account...");

  const accountAddress = getAccountAddress();
  const fetchedAccount = await MarginfiAccount.fetch(accountAddress, rpc);

  console.log(`✅ Account loaded: ${fetchedAccount.address}`);

  // --------------------------------------------------------------------------
  // Step 4: Simulate Health Cache
  // --------------------------------------------------------------------------
  console.log("\n🔄 Simulating health cache update...");
  console.log("   This simulates refreshing venue state and calling PulseHealth on-chain");

  // `client.fetchAccount(address)` does steps 3-4 in one call.
  const { account, error } = await new MarginfiAccountWrapper(
    fetchedAccount,
    client
  ).simulateHealthCache();

  if (error) {
    console.warn(`⚠️  Health cache simulation had issues: ${error.message}`);
    console.log("   Falling back to the computed health cache");
  } else {
    console.log("✅ Health cache simulated successfully");
  }

  // --------------------------------------------------------------------------
  // Step 5: Display Health Metrics from Simulated Cache
  // --------------------------------------------------------------------------
  console.log("\n📊 Health Metrics (from simulated cache):\n");

  const wrappedAccount = new MarginfiAccountWrapper(account, client);

  // Health components use the simulated cache
  const initHealth = wrappedAccount.computeHealthComponentsFromCache(
    MarginRequirementType.Initial
  );
  const maintHealth = wrappedAccount.computeHealthComponentsFromCache(
    MarginRequirementType.Maintenance
  );
  const equityHealth = wrappedAccount.computeHealthComponentsFromCache(
    MarginRequirementType.Equity
  );

  console.log("💰 Initial Health (for borrowing):");
  console.log(`   Assets: $${initHealth.assets.toFixed(2)}`);
  console.log(`   Liabilities: $${initHealth.liabilities.toFixed(2)}`);
  if (initHealth.liabilities.gt(0)) {
    console.log(
      `   Health Factor: ${initHealth.assets.div(initHealth.liabilities).toFixed(4)}`
    );
  }

  console.log("\n💰 Maintenance Health (for liquidation):");
  console.log(`   Assets: $${maintHealth.assets.toFixed(2)}`);
  console.log(`   Liabilities: $${maintHealth.liabilities.toFixed(2)}`);
  if (maintHealth.liabilities.gt(0)) {
    console.log(
      `   Health Factor: ${maintHealth.assets.div(maintHealth.liabilities).toFixed(4)}`
    );
  }

  console.log("\n💰 Equity (actual value):");
  console.log(`   Assets: $${equityHealth.assets.toFixed(2)}`);
  console.log(`   Liabilities: $${equityHealth.liabilities.toFixed(2)}`);
  console.log(
    `   Net Value: $${equityHealth.assets.minus(equityHealth.liabilities).toFixed(2)}`
  );

  // Free collateral
  const freeCollateral = wrappedAccount.computeFreeCollateralFromCache();
  console.log(`\n💵 Free Collateral: $${freeCollateral.toFixed(2)}`);
  console.log("   (Additional borrowing power available)");

  // Account value
  const accountValue = wrappedAccount.computeAccountValue();
  console.log(`\n💎 Account Value (Equity): $${accountValue.toFixed(2)}`);

  // Net APY
  const netApy = wrappedAccount.computeNetApy();
  console.log(`\n📈 Net APY: ${(netApy * 100).toFixed(4)}%`);

  // --------------------------------------------------------------------------
  // Step 6: Display Cache Details
  // --------------------------------------------------------------------------
  console.log("\n🔍 Health Cache Details:");
  console.log(
    `   Asset Value (Init): $${account.healthCache.assetValue.toFixed(2)}`
  );
  console.log(
    `   Liability Value (Init): $${account.healthCache.liabilityValue.toFixed(2)}`
  );
  console.log(
    `   Asset Value (Maint): $${account.healthCache.assetValueMaint.toFixed(2)}`
  );
  console.log(
    `   Liability Value (Maint): $${account.healthCache.liabilityValueMaint.toFixed(2)}`
  );
  console.log(
    `   Asset Value (Equity): $${account.healthCache.assetValueEquity.toFixed(2)}`
  );
  console.log(
    `   Liability Value (Equity): $${account.healthCache.liabilityValueEquity.toFixed(2)}`
  );
  console.log(
    `   Cache Status: ${account.healthCache.simulationStatus || "SIMULATED"}`
  );

  // --------------------------------------------------------------------------
  // Step 7: Show Individual Balances
  // --------------------------------------------------------------------------
  console.log("\n📦 Active Balances:");

  const activeBalances = account.balances.filter((b) => b.active);

  if (activeBalances.length === 0) {
    console.log("   No active balances");
  } else {
    activeBalances.forEach((balance) => {
      const bank = client.getBank(balance.bankPk);
      if (bank) {
        console.log(`\n   ${bank.tokenSymbol ?? bank.mint.slice(0, 8)}:`);

        const { assets, liabilities } = balance.computeQuantityUi(
          bank,
          client.assetShareValueMultiplierByBank.get(bank.address)
        );

        if (assets.gt(0)) {
          console.log(`      Assets: ${assets.toFixed(6)} tokens`);
        }

        if (liabilities.gt(0)) {
          console.log(`      Liabilities: ${liabilities.toFixed(6)} tokens`);
        }
      }
    });
  }
}

// ============================================================================
// Run Example
// ============================================================================

accountHealthSimulatedExample()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n❌ Error:", error);
    process.exit(1);
  });
