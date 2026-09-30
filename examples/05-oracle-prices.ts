/**
 * Example: Fetch oracle prices
 *
 * This example shows how to:
 * 1. Initialize the Project0Client from config
 * 2. Access oracle prices for all banks
 * 3. Re-fetch oracle prices
 *
 * Setup:
 * 1. Copy .env.example to .env
 * 2. Fill in your configuration values
 * 3. Run: tsx 05-oracle-prices.ts
 */

import { Project0Client, fetchOracleData } from "../src";
import { getRpc, getMarginfiConfig, MINTS } from "./config";

// ============================================================================
// Main Example
// ============================================================================

async function oraclePricesExample() {
  // --------------------------------------------------------------------------
  // Step 1: Load Configuration
  // --------------------------------------------------------------------------
  console.log("\n🔧 Loading configuration...");

  const { rpc, rpcEndpoint } = getRpc();
  const config = getMarginfiConfig();

  console.log(`   RPC: ${rpcEndpoint}`);
  console.log(`   Environment: ${config.environment}`);

  // --------------------------------------------------------------------------
  // Step 2: Initialize Client
  // --------------------------------------------------------------------------
  console.log("\n📡 Initializing Project0Client...");

  const client = await Project0Client.initialize({ rpc, rpcEndpoint }, config);

  console.log("✅ Client initialized with oracle prices");
  console.log(`📊 Loaded ${client.banks.length} banks`);

  // --------------------------------------------------------------------------
  // Step 3: Access Oracle Prices for All Banks
  // --------------------------------------------------------------------------
  console.log("\n💰 Accessing oracle prices for all banks...\n");

  client.bankMap.forEach((bank, bankAddress) => {
    const oraclePrice = client.oraclePriceByBank.get(bankAddress);

    if (oraclePrice) {
      console.log(`Bank: ${bank.tokenSymbol ?? bank.mint} (${bankAddress})`);
      console.log(
        `   Realtime price: $${oraclePrice.priceRealtime.price.toNumber()}`
      );
      console.log(
        `   Confidence: ±$${oraclePrice.priceRealtime.confidence.toNumber()}`
      );
      console.log(
        `   Timestamp: ${new Date(oraclePrice.timestamp.toNumber() * 1000).toISOString()}`
      );
      console.log("");
    }
  });

  // --------------------------------------------------------------------------
  // Step 4: Manually Refresh Oracle Prices
  // --------------------------------------------------------------------------
  console.log("🔄 Refreshing oracle prices...");

  const updatedOracleData = await fetchOracleData(
    client.banks, // Array of all banks
    {
      pythOpts: { mode: "on-chain", rpc }, // or "api" for faster lookups
      scopeOpts: { mode: "on-chain", rpc },
      oracleMultiplierOpts: { mode: "on-chain", rpc },
      isolatedBanksOpts: { fetchPrices: true },
    }
  );

  console.log(
    `✅ Refreshed ${updatedOracleData.bankOraclePriceMap.size} oracle prices`
  );

  // --------------------------------------------------------------------------
  // Step 5: Access Specific Bank Oracle Price
  // --------------------------------------------------------------------------
  console.log("\n💵 Accessing specific bank oracle price...");

  const usdcOraclePrice = updatedOracleData.mintOraclePriceMap.get(MINTS.USDC);

  if (usdcOraclePrice) {
    console.log(
      `   USDC Price: $${usdcOraclePrice.priceRealtime.price.toNumber()}`
    );
  }
}

// ============================================================================
// Run Example
// ============================================================================

oraclePricesExample()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n❌ Error:", error);
    process.exit(1);
  });
