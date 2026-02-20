/**
 * Example: Account Health with Legacy Calculation
 *
 * This example shows how to:
 * 1. Initialize the Project0Client from config
 * 2. Fetch a marginfi account
 * 3. Calculate health metrics using oracle prices directly (legacy method)
 * 4. Compare results with cached health values
 *
 * The legacy calculation approach:
 * - Uses current oracle prices from the client
 * - Manually calculates asset and liability values
 * - Applies margin requirements (init, maintenance, equity)
 * - Does NOT simulate on-chain transactions
 * - Faster but may differ from on-chain health cache
 *
 * Setup:
 * 1. Copy .env.example to .env
 * 2. Fill in your configuration values
 * 3. Run: tsx 06b-account-health-legacy.ts
 */

import {
  Project0Client,
  MarginfiAccount,
  MarginRequirementType,
} from "../src";
import { getConnection, getMarginfiConfig, getAccountAddress } from "./config";

// ============================================================================
// Main Example
// ============================================================================

async function accountHealthCalculatedExample() {
  // --------------------------------------------------------------------------
  // Step 1: Load Configuration
  // --------------------------------------------------------------------------
  console.log("\n🔧 Loading configuration...");

  const connection = getConnection();
  const config = getMarginfiConfig();

  console.log(`   RPC: ${connection.rpcEndpoint}`);
  console.log(`   Environment: ${config.environment}`);

  // --------------------------------------------------------------------------
  // Step 2: Initialize Project0Client
  // --------------------------------------------------------------------------
  console.log("\n📡 Initializing Project0Client...");

  const client = await Project0Client.initialize(connection, config);

  console.log(`✅ Client initialized`);
  console.log(`📊 Loaded ${client.banks.length} banks`);

  // --------------------------------------------------------------------------
  // Step 3: Load Marginfi Account
  // --------------------------------------------------------------------------
  console.log("\n👤 Loading marginfi account...");

  const accountAddress = getAccountAddress();
  const account = await MarginfiAccount.fetch(accountAddress, client.program);

  console.log(`✅ Account loaded: ${account.address.toBase58()}`);

  // --------------------------------------------------------------------------
  // Step 4: Compute Health Using Legacy Method
  // --------------------------------------------------------------------------
  console.log("\n🧮 Computing health using legacy method (oracle prices)...");
  console.log(
    "   This uses current oracle prices to calculate health directly"
  );

  // Compute health components using legacy method
  const initHealthLegacy = account.computeHealthComponentsLegacy(
    client.bankMap,
    client.oraclePriceByBank,
    MarginRequirementType.Initial
  );

  const maintHealthLegacy = account.computeHealthComponentsLegacy(
    client.bankMap,
    client.oraclePriceByBank,
    MarginRequirementType.Maintenance
  );

  const equityHealthLegacy = account.computeHealthComponentsLegacy(
    client.bankMap,
    client.oraclePriceByBank,
    MarginRequirementType.Equity
  );

  console.log("✅ Legacy calculation complete");

  // --------------------------------------------------------------------------
  // Step 5: Display Legacy Health Metrics
  // --------------------------------------------------------------------------
  console.log("\n📊 Health Metrics (legacy calculation):\n");

  console.log("💰 Initial Health (for borrowing):");
  console.log(`   Assets: $${initHealthLegacy.assets.toFixed(2)}`);
  console.log(`   Liabilities: $${initHealthLegacy.liabilities.toFixed(2)}`);
  if (initHealthLegacy.liabilities.gt(0)) {
    console.log(
      `   Health Factor: ${initHealthLegacy.assets.div(initHealthLegacy.liabilities).toFixed(4)}`
    );
  } else {
    console.log(`   Health Factor: ∞ (no liabilities)`);
  }

  console.log("\n💰 Maintenance Health (for liquidation):");
  console.log(`   Assets: $${maintHealthLegacy.assets.toFixed(2)}`);
  console.log(`   Liabilities: $${maintHealthLegacy.liabilities.toFixed(2)}`);
  if (maintHealthLegacy.liabilities.gt(0)) {
    console.log(
      `   Health Factor: ${maintHealthLegacy.assets.div(maintHealthLegacy.liabilities).toFixed(4)}`
    );
  } else {
    console.log(`   Health Factor: ∞ (no liabilities)`);
  }

  console.log("\n💰 Equity (actual value):");
  console.log(`   Assets: $${equityHealthLegacy.assets.toFixed(2)}`);
  console.log(`   Liabilities: $${equityHealthLegacy.liabilities.toFixed(2)}`);
  console.log(
    `   Net Value: $${equityHealthLegacy.assets.minus(equityHealthLegacy.liabilities).toFixed(2)}`
  );

  // Compute free collateral using legacy method
  const freeCollateralLegacy = account.computeFreeCollateralLegacy(
    client.bankMap,
    client.oraclePriceByBank
  );
  console.log(`\n💵 Free Collateral: $${freeCollateralLegacy.toFixed(2)}`);
  console.log("   (Additional borrowing power available)");

  // Net APY
  const netApy = account.computeNetApy(
    client.bankMap,
    client.oraclePriceByBank
  );
  console.log(`\n📈 Net APY: ${(netApy * 100).toFixed(4)}%`);

  // --------------------------------------------------------------------------
  // Step 6: Compare with Cached Health Values
  // --------------------------------------------------------------------------
  console.log("\n🔍 Comparison with On-Chain Health Cache:");
  console.log("   (Cache may be stale - use simulation for fresh values)\n");

  console.log("   Initial Health:");
  console.log(
    `     Legacy: $${initHealthLegacy.assets.toFixed(2)} / $${initHealthLegacy.liabilities.toFixed(2)}`
  );
  console.log(
    `     Cached: $${account.healthCache.assetValue.toFixed(2)} / $${account.healthCache.liabilityValue.toFixed(2)}`
  );

  const initDiff = initHealthLegacy.assets
    .minus(account.healthCache.assetValue)
    .abs();
  console.log(`     Difference: $${initDiff.toFixed(2)}`);

  console.log("\n   Maintenance Health:");
  console.log(
    `     Legacy: $${maintHealthLegacy.assets.toFixed(2)} / $${maintHealthLegacy.liabilities.toFixed(2)}`
  );
  console.log(
    `     Cached: $${account.healthCache.assetValueMaint.toFixed(2)} / $${account.healthCache.liabilityValueMaint.toFixed(2)}`
  );

  const maintDiff = maintHealthLegacy.assets
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
      const bank = client.bankMap.get(balance.bankPk.toBase58());
      if (bank) {
        const oraclePrice = client.oraclePriceByBank.get(
          balance.bankPk.toBase58()
        );

        console.log(
          `\n   ${bank.tokenSymbol || bank.mint.toBase58().slice(0, 8)}:`
        );
        console.log(`      Bank: ${bank.address.toBase58()}`);

        if (oraclePrice) {
          console.log(
            `      Oracle Price: $${oraclePrice.priceRealtime.price.toFixed(6)} (conf: ${oraclePrice.priceRealtime.confidence.toFixed(6)})`
          );
        }

        if (!balance.assetShares.isZero()) {
          const assetQuantity = bank.getAssetQuantity(balance.assetShares);
          const uiAsset = assetQuantity.div(Math.pow(10, bank.mintDecimals));
          console.log(`      Assets: ${uiAsset.toFixed(6)} tokens`);

          if (oraclePrice) {
            const assetValue = uiAsset.times(oraclePrice.priceRealtime.price);
            console.log(`      Asset Value: $${assetValue.toFixed(2)}`);
          }
        }

        if (!balance.liabilityShares.isZero()) {
          const liabilityQuantity = bank.getLiabilityQuantity(
            balance.liabilityShares
          );
          const uiLiability = liabilityQuantity.div(
            Math.pow(10, bank.mintDecimals)
          );
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
  console.log("   Legacy Calculation:");
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
