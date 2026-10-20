/**
 * Example: Account Health calculated from balances
 *
 * This example shows how to:
 * 1. Initialize the Project0Client from config
 * 2. Fetch a marginfi account
 * 3. Calculate health metrics using oracle prices directly (balance-based method)
 * 4. Compare results with cached health values
 *
 * The balance-based approach:
 * - Uses current oracle prices from the client
 * - Manually calculates asset and liability values
 * - Applies margin requirements (init, maintenance, equity)
 * - Does NOT simulate on-chain transactions
 * - Faster but may differ from on-chain health cache
 *
 * Setup:
 * 1. Copy .env.example to .env
 * 2. Fill in your configuration values
 * 3. Run: tsx 06b-account-health-calculated.ts
 */

import { Project0Client, MarginfiAccount, MarginRequirementType } from "../src";
import { getRpc, getMarginfiConfig, getAccountAddress } from "./config";

// ============================================================================
// Main Example
// ============================================================================

async function accountHealthCalculatedExample() {
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
  const account = await MarginfiAccount.fetch(accountAddress, rpc);

  console.log(`✅ Account loaded: ${account.address}`);

  // --------------------------------------------------------------------------
  // Step 4: Compute Health from Balances
  // --------------------------------------------------------------------------
  console.log("\n🧮 Computing health using balance-based method (oracle prices)...");
  console.log(
    "   This uses current oracle prices to calculate health directly"
  );

  // Prices, share multipliers (Kamino/Drift/JupLend) and banks from the client
  const pricing = {
    banksMap: client.bankMap,
    oraclePricesByBank: client.oraclePriceByBank,
    assetShareValueMultiplierByBank: client.assetShareValueMultiplierByBank,
  };

  const initHealthCalculated = account.computeHealthComponentsFromBalances({
    ...pricing,
    marginRequirement: MarginRequirementType.Initial,
  });

  const maintHealthCalculated = account.computeHealthComponentsFromBalances({
    ...pricing,
    marginRequirement: MarginRequirementType.Maintenance,
  });

  const equityHealthCalculated = account.computeHealthComponentsFromBalances({
    ...pricing,
    marginRequirement: MarginRequirementType.Equity,
  });

  console.log("✅ Calculation complete");

  // --------------------------------------------------------------------------
  // Step 5: Display Calculated Health Metrics
  // --------------------------------------------------------------------------
  console.log("\n📊 Health Metrics (calculation from balances):\n");

  console.log("💰 Initial Health (for borrowing):");
  console.log(`   Assets: $${initHealthCalculated.assets.toFixed(2)}`);
  console.log(`   Liabilities: $${initHealthCalculated.liabilities.toFixed(2)}`);
  if (initHealthCalculated.liabilities.gt(0)) {
    console.log(
      `   Health Factor: ${initHealthCalculated.assets.div(initHealthCalculated.liabilities).toFixed(4)}`
    );
  } else {
    console.log(`   Health Factor: ∞ (no liabilities)`);
  }

  console.log("\n💰 Maintenance Health (for liquidation):");
  console.log(`   Assets: $${maintHealthCalculated.assets.toFixed(2)}`);
  console.log(`   Liabilities: $${maintHealthCalculated.liabilities.toFixed(2)}`);
  if (maintHealthCalculated.liabilities.gt(0)) {
    console.log(
      `   Health Factor: ${maintHealthCalculated.assets.div(maintHealthCalculated.liabilities).toFixed(4)}`
    );
  } else {
    console.log(`   Health Factor: ∞ (no liabilities)`);
  }

  console.log("\n💰 Equity (actual value):");
  console.log(`   Assets: $${equityHealthCalculated.assets.toFixed(2)}`);
  console.log(`   Liabilities: $${equityHealthCalculated.liabilities.toFixed(2)}`);
  console.log(
    `   Net Value: $${equityHealthCalculated.assets.minus(equityHealthCalculated.liabilities).toFixed(2)}`
  );

  // Compute free collateral using balance-based method
  const freeCollateralCalculated = account.computeFreeCollateralFromBalances(pricing);
  console.log(`\n💵 Free Collateral: $${freeCollateralCalculated.toFixed(2)}`);
  console.log("   (Additional borrowing power available)");

  // Net APY
  const netApy = account.computeNetApy(pricing);
  console.log(`\n📈 Net APY: ${(netApy * 100).toFixed(4)}%`);

  // --------------------------------------------------------------------------
  // Step 6: Compare with Cached Health Values
  // --------------------------------------------------------------------------
  console.log("\n🔍 Comparison with On-Chain Health Cache:");
  console.log("   (Cache may be stale - use simulation for fresh values)\n");

  console.log("   Initial Health:");
  console.log(
    `     Calculated: $${initHealthCalculated.assets.toFixed(2)} / $${initHealthCalculated.liabilities.toFixed(2)}`
  );
  console.log(
    `     Cached: $${account.healthCache.assetValue.toFixed(2)} / $${account.healthCache.liabilityValue.toFixed(2)}`
  );

  const initDiff = initHealthCalculated.assets
    .minus(account.healthCache.assetValue)
    .abs();
  console.log(`     Difference: $${initDiff.toFixed(2)}`);

  console.log("\n   Maintenance Health:");
  console.log(
    `     Calculated: $${maintHealthCalculated.assets.toFixed(2)} / $${maintHealthCalculated.liabilities.toFixed(2)}`
  );
  console.log(
    `     Cached: $${account.healthCache.assetValueMaint.toFixed(2)} / $${account.healthCache.liabilityValueMaint.toFixed(2)}`
  );

  const maintDiff = maintHealthCalculated.assets
    .minus(account.healthCache.assetValueMaint)
    .abs();
  console.log(`     Difference: $${maintDiff.toFixed(2)}`);

  // --------------------------------------------------------------------------
  // Step 7: Show Individual Balances with Prices
  // --------------------------------------------------------------------------
  console.log("\n📦 Active Balances (with current oracle prices):");

  const activeBalances = account.balances.filter((b) => b.active);

  if (activeBalances.length === 0) {
    console.log("   No active balances");
  } else {
    activeBalances.forEach((balance) => {
      const bank = client.getBank(balance.bankPk);
      if (bank) {
        const oraclePrice = client.oraclePriceByBank.get(balance.bankPk);
        const { assets: uiAsset, liabilities: uiLiability } = balance.computeQuantityUi(
          bank,
          client.assetShareValueMultiplierByBank.get(bank.address)
        );

        console.log(`\n   ${bank.tokenSymbol ?? bank.mint.slice(0, 8)}:`);
        console.log(`      Bank: ${bank.address}`);

        if (oraclePrice) {
          console.log(
            `      Oracle Price: $${oraclePrice.priceRealtime.price.toFixed(6)} (conf: ${oraclePrice.priceRealtime.confidence.toFixed(6)})`
          );
        }

        if (uiAsset.gt(0)) {
          console.log(`      Assets: ${uiAsset.toFixed(6)} tokens`);

          if (oraclePrice) {
            const assetValue = uiAsset.times(oraclePrice.priceRealtime.price);
            console.log(`      Asset Value: $${assetValue.toFixed(2)}`);
          }
        }

        if (uiLiability.gt(0)) {
          console.log(`      Liabilities: ${uiLiability.toFixed(6)} tokens`);

          if (oraclePrice) {
            const liabilityValue = uiLiability.times(
              oraclePrice.priceRealtime.price
            );
            console.log(`      Liability Value: $${liabilityValue.toFixed(2)}`);
          }
        }
      }
    });
  }

  // --------------------------------------------------------------------------
  // Step 8: Explanation of Differences
  // --------------------------------------------------------------------------
  console.log("\n\n📚 Understanding the Difference:");
  console.log("   Calculated from balances:");
  console.log("   ✅ Uses current oracle prices");
  console.log("   ✅ Fast computation (no simulation)");
  console.log("   ✅ Good for quick estimates");
  console.log("   ⚠️  May differ from on-chain health cache");
  console.log("   ⚠️  Oracle prices may have changed since last update");

  console.log("\n   Health Cache (on-chain):");
  console.log("   ✅ Matches actual on-chain state");
  console.log("   ✅ Used by protocol for health checks");
  console.log("   ⚠️  May be stale (needs PulseHealth to update)");
  console.log("   ⚠️  Oracle prices frozen at last update time");

  console.log("\n   Use simulation (06a-account-health-simulated.ts) for:");
  console.log("   ✅ Most accurate health values");
  console.log("   ✅ Refreshed oracle prices");
  console.log("   ✅ Updated health cache");
  console.log("   ⚠️  Slower (requires simulation)");
}

// ============================================================================
// Run Example
// ============================================================================

accountHealthCalculatedExample()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n❌ Error:", error);
    process.exit(1);
  });
