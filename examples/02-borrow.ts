/**
 * Example: Borrow tokens from a bank
 *
 * This example shows how to:
 * 1. Initialize the Project0Client from config
 * 2. Fetch a marginfi account
 * 3. Create a wrapper for clean API
 * 4. Check max borrow capacity
 * 5. Build and simulate a borrow transaction
 *
 * Setup:
 * 1. Copy .env.example to .env
 * 2. Fill in your configuration values
 * 3. Run: tsx 02-borrow.ts
 */

import { compileTransaction, getBase64EncodedWireTransaction } from "@solana/kit";

import { Project0Client, AssetTag } from "../src";
import { getRpc, getMarginfiConfig, getAccountAddress, MINTS } from "./config";

// ============================================================================
// Configuration
// ============================================================================

const BORROW_AMOUNT = "50"; // USDC amount to borrow (UI units)

// ============================================================================
// Main Example
// ============================================================================

async function borrowExample() {
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
  // Refreshes the health cache by simulation: the max amounts below are computed from it.
  const wrappedAccount = await client.fetchAccount(accountAddress);
  const account = wrappedAccount.getUnderlyingAccount();

  console.log(`✅ Account loaded: ${account.address}`);
  console.log(`   Authority: ${account.authority}`);

  // --------------------------------------------------------------------------
  // Step 4: Select Bank
  // --------------------------------------------------------------------------
  console.log("\n🏦 Selecting USDC bank...");

  const usdcBanks = client.getBanksByMint(MINTS.USDC, AssetTag.DEFAULT);

  if (usdcBanks.length === 0) {
    throw new Error("USDC bank not found");
  }

  const usdcBank = usdcBanks[0];
  console.log(`✅ Bank selected: ${usdcBank.address}`);
  console.log(`   Mint: ${usdcBank.mint}`);

  // --------------------------------------------------------------------------
  // Step 5: Check Borrow Capacity
  // --------------------------------------------------------------------------
  console.log("\n📊 Checking borrow capacity...");

  const maxBorrow = wrappedAccount.computeMaxBorrowForBank(usdcBank.address);
  console.log(`   Max borrow: ${maxBorrow.toString()} USDC`);

  // --------------------------------------------------------------------------
  // Step 6: Build Borrow Transaction
  // --------------------------------------------------------------------------
  const actualBorrowAmount = Math.min(
    Number(BORROW_AMOUNT),
    maxBorrow.toNumber()
  ).toString();
  console.log(
    `\n📝 Building borrow transaction for ${actualBorrowAmount} USDC...`
  );

  const borrowTx = await wrappedAccount.makeBorrowTx(usdcBank.address, actualBorrowAmount);

  console.log(`✅ Transaction built successfully`);

  // --------------------------------------------------------------------------
  // Step 7: Simulate Transaction
  // --------------------------------------------------------------------------
  console.log("\n🔄 Simulating transaction...");

  const wireTransaction = getBase64EncodedWireTransaction(compileTransaction(borrowTx.message));

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

    console.log("\n✅ Simulation successful!");
    console.log(`   Compute units used: ${simulation.value.unitsConsumed}`);
  } catch (error) {
    console.error("\n❌ Simulation error:", error);
    throw error;
  }
}

// ============================================================================
// Run Example
// ============================================================================

borrowExample()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n❌ Error:", error);
    process.exit(1);
  });
