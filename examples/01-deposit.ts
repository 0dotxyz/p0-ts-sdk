/**
 * Example: Deposit tokens into a bank (SIMULATION MODE)
 *
 * This example shows how to:
 * 1. Initialize the Project0Client from config
 * 2. Fetch a marginfi account
 * 3. Create a wrapper for clean API
 * 4. Build deposit instructions and simulate
 *
 * Setup:
 * 1. Copy .env.example to .env
 * 2. Fill in your MARGINFI_ACCOUNT_ADDRESS (no private key needed!)
 * 3. Run: tsx 01-deposit.ts
 *
 * Note: This runs in SIMULATION mode - no actual transactions are sent. The wrapper signs with a
 * noop signer for the account authority; pass your wallet's signer as the wrapper's third argument
 * and use `signTransactionMessageWithSigners` to send for real.
 */

import { compileTransaction, getBase64EncodedWireTransaction } from "@solana/kit";

import { Project0Client, MarginfiAccountWrapper, MarginfiAccount, AssetTag } from "../src";
import { getRpc, getMarginfiConfig, getAccountAddress, MINTS } from "./config";

// ============================================================================
// Configuration
// ============================================================================

const DEPOSIT_AMOUNT = "0.001"; // SOL amount to deposit (UI units)

// ============================================================================
// Main Example
// ============================================================================

async function depositExample() {
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
  // Step 4: Select Bank
  // --------------------------------------------------------------------------
  console.log("\n🏦 Selecting SOL bank...");

  const solBanks = client.getBanksByMint(MINTS.SOL, AssetTag.SOL);

  if (solBanks.length === 0) {
    throw new Error("SOL bank not found");
  }

  const solBank = solBanks[0];
  console.log(`✅ Bank selected: ${solBank.address}`);
  console.log(`   Mint: ${solBank.mint}`);

  // --------------------------------------------------------------------------
  // Step 5: Build Deposit Transaction
  // --------------------------------------------------------------------------
  // Bank deposit cap check (remaining capacity in UI units)
  const maxDeposit = wrappedAccount.computeMaxDepositForBank(solBank.address);
  console.log(`   Max deposit (bank cap remaining): ${maxDeposit.toString()} SOL`);

  console.log(`\n📝 Building deposit transaction for ${DEPOSIT_AMOUNT} SOL...`);

  const depositTx = await wrappedAccount.makeDepositTx(
    solBank.address,
    DEPOSIT_AMOUNT
  );

  console.log(`✅ Transaction built successfully`);

  // --------------------------------------------------------------------------
  // Step 6: Simulate Transaction
  // --------------------------------------------------------------------------
  console.log("\n🔄 Simulating transaction...");

  // Compile the message (fee payer, blockhash and lookup tables are already set) and simulate it
  // without signatures.
  const wireTransaction = getBase64EncodedWireTransaction(compileTransaction(depositTx.message));

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

depositExample()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n❌ Error:", error);
    process.exit(1);
  });
