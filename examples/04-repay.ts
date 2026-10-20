/**
 * Example: Repay borrowed tokens
 *
 * This example shows how to:
 * 1. Initialize the Project0Client from config
 * 2. Fetch a marginfi account
 * 3. Check liability positions (borrows)
 * 4. Find the first position with a liability
 * 5. Calculate repay amount (10% of liability)
 * 6. Build and simulate repay transaction
 *
 * Setup:
 * 1. Copy .env.example to .env
 * 2. Fill in your configuration values
 * 3. Run: tsx 04-repay.ts
 */

import { compileTransaction, getBase64EncodedWireTransaction } from "@solana/kit";

import { Project0Client, MarginfiAccountWrapper, MarginfiAccount } from "../src";
import { getRpc, getMarginfiConfig, getAccountAddress } from "./config";

// ============================================================================
// Configuration
// ============================================================================

const REPAY_ALL = false; // Set to true to repay entire debt
const REPAY_PERCENTAGE = 0.1; // Repay 10% of the liability

// ============================================================================
// Main Example
// ============================================================================

async function repayExample() {
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

  console.log(`✅ Client initialized`);
  console.log(`📊 Loaded ${client.banks.length} banks`);

  // --------------------------------------------------------------------------
  // Step 3: Load Marginfi Account
  // --------------------------------------------------------------------------
  console.log("\n👤 Loading marginfi account...");

  const accountAddress = getAccountAddress();
  const account = await MarginfiAccount.fetch(accountAddress, rpc);
  const wrappedAccount = new MarginfiAccountWrapper(account, client);

  console.log(`✅ Account loaded: ${account.address}`);
  console.log(`   Authority: ${account.authority}`);

  // --------------------------------------------------------------------------
  // Step 4: Find First Liability Position
  // --------------------------------------------------------------------------
  console.log("\n💸 Checking liability positions...");

  // Get all active liability positions (borrows)
  const liabilityBalances = account.balances.filter(
    (balance) => balance.active && !balance.liabilityShares.isZero()
  );

  console.log(`   Found ${liabilityBalances.length} active liability position(s)`);

  if (liabilityBalances.length === 0) {
    throw new Error("No liability positions found. Borrow some tokens first.");
  }

  // Use the first liability position
  const firstLiability = liabilityBalances[0];
  const bankAddress = firstLiability.bankPk;
  const bank = client.getBank(bankAddress);

  if (!bank) {
    throw new Error(`Bank ${bankAddress} not found`);
  }

  // Token amount (UI units) from liability shares
  const uiAmount = firstLiability.computeQuantityUi(bank).liabilities;

  console.log(`\n✅ Selected first liability position:`);
  console.log(`   Bank: ${bank.address}`);
  console.log(`   Mint: ${bank.mint}`);
  console.log(`   Liability: ${uiAmount.toFixed(6)} tokens`);

  // --------------------------------------------------------------------------
  // Step 5: Calculate Repay Amount
  // --------------------------------------------------------------------------
  console.log("\n📊 Calculating repay amount...");

  // Repay a percentage of the liability
  const repayAmount = Math.min(
    uiAmount.toNumber() * REPAY_PERCENTAGE,
    uiAmount.toNumber() // But not more than the total liability
  ).toString();

  console.log(`   Repaying: ${repayAmount} tokens (${REPAY_PERCENTAGE * 100}% of liability)`);

  // --------------------------------------------------------------------------
  // Step 6: Build Repay Transaction
  // --------------------------------------------------------------------------
  console.log(`\n📝 Building repay transaction...`);

  const repayTx = await wrappedAccount.makeRepayTx(
    bank.address,
    repayAmount,
    REPAY_ALL
  );

  console.log(`✅ Transaction built successfully`);

  // --------------------------------------------------------------------------
  // Step 7: Simulate Transaction
  // --------------------------------------------------------------------------
  console.log("\n🔄 Simulating transaction...");

  const wireTransaction = getBase64EncodedWireTransaction(compileTransaction(repayTx.message));

  try {
    const simulation = await rpc
      .simulateTransaction(wireTransaction, {
        encoding: "base64",
        sigVerify: false,
        replaceRecentBlockhash: true,
      })
      .send();

    if (simulation.value.err) {
      console.error("\n❌ Simulation failed:", simulation.value.err);
      console.error("\nLogs:", simulation.value.logs);
      return;
    }

    // Simulation successful
    console.log("\n✅ Simulation successful!");
    console.log(`   Compute units used: ${simulation.value.unitsConsumed}`);

    if (simulation.value.logs && simulation.value.logs.length > 0) {
      console.log("\n📋 Transaction logs:");
      simulation.value.logs.forEach((log) => console.log(`   ${log}`));
    }
  } catch (error) {
    console.error("\n❌ Simulation error:", error);
    throw error;
  }
}

// ============================================================================
// Run Example
// ============================================================================

repayExample()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n❌ Error:", error);
    process.exit(1);
  });
