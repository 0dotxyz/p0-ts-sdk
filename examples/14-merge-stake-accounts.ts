/**
 * Example: Merge Two Stake Accounts (SIMULATION MODE)
 *
 * This example shows how to:
 * 1. Initialize the Project0Client
 * 2. Fetch a marginfi account and create a wrapper
 * 3. Build a transaction that merges two native stake accounts into one
 * 4. Simulate the transaction
 *
 * Prerequisites:
 * - Both stake accounts must share the same authorized staker and withdrawer
 * - Both must be delegated to the same validator vote account
 * - Both must be in the "active" state
 *
 * Setup:
 * 1. Copy .env.example to .env
 * 2. Fill in your MARGINFI_ACCOUNT_ADDRESS and WALLET_ADDRESS
 * 3. Set SOURCE_STAKE_ACCOUNT and DESTINATION_STAKE_ACCOUNT below
 * 4. Run: tsx 14-merge-stake-accounts.ts
 *
 * Note: This runs in SIMULATION mode - no actual transactions are sent.
 */

import {
  Project0Client,
  MarginfiAccountWrapper,
  MarginfiAccount,
} from "../src";
import { PublicKey } from "@solana/web3.js";
import {
  getConnection,
  getMarginfiConfig,
  getAccountAddress,
  getWalletPubkey,
} from "./config";

// ============================================================================
// Configuration
// ============================================================================

// The stake account to merge FROM (will be consumed)
const SOURCE_STAKE_ACCOUNT = new PublicKey("YOUR_SOURCE_STAKE_ACCOUNT_HERE");

// The stake account to merge INTO (will receive the combined balance)
const DESTINATION_STAKE_ACCOUNT = new PublicKey("YOUR_DESTINATION_STAKE_ACCOUNT_HERE");

// ============================================================================
// Main Example
// ============================================================================

async function mergeStakeAccountsExample() {
  // --------------------------------------------------------------------------
  // Step 1: Load Configuration
  // --------------------------------------------------------------------------
  console.log("\n🔧 Loading configuration...");

  const connection = getConnection();
  const walletPubkey = getWalletPubkey();
  const config = getMarginfiConfig();

  console.log(`   RPC: ${connection.rpcEndpoint}`);
  console.log(`   Wallet: ${walletPubkey.toBase58()}`);
  console.log(`   Source: ${SOURCE_STAKE_ACCOUNT.toBase58()}`);
  console.log(`   Destination: ${DESTINATION_STAKE_ACCOUNT.toBase58()}`);

  // --------------------------------------------------------------------------
  // Step 2: Initialize Client
  // --------------------------------------------------------------------------
  console.log("\n📡 Initializing Project0Client...");

  const client = await Project0Client.initialize(connection, {
    environment: config.environment,
    groupPk: config.groupPk,
    programId: config.programId,
  });

  console.log(`   Banks loaded: ${client.bankMap.size}`);

  // --------------------------------------------------------------------------
  // Step 3: Fetch Account & Create Wrapper
  // --------------------------------------------------------------------------
  console.log("\n👤 Fetching marginfi account...");

  const accountAddress = getAccountAddress();
  const account = await MarginfiAccount.fetch(accountAddress, client.program);
  const wrappedAccount = new MarginfiAccountWrapper(account, client);

  console.log(`   Account: ${wrappedAccount.address.toBase58()}`);
  console.log(`   Authority: ${wrappedAccount.authority.toBase58()}`);

  // --------------------------------------------------------------------------
  // Step 4: Build Merge Transaction
  // --------------------------------------------------------------------------
  console.log("\n🏗️  Building merge stake accounts transaction...");

  const tx = await wrappedAccount.makeMergeStakeAccountsTx(
    SOURCE_STAKE_ACCOUNT,
    DESTINATION_STAKE_ACCOUNT
  );

  console.log(`   Transaction built successfully`);
  console.log(`   Instructions: ${tx.message.compiledInstructions.length}`);

  // --------------------------------------------------------------------------
  // Step 5: Simulate Transaction
  // --------------------------------------------------------------------------
  console.log("\n🔍 Simulating transaction...");

  const simulation = await connection.simulateTransaction(tx);

  if (simulation.value.err) {
    console.error("❌ Simulation failed:", simulation.value.err);
    if (simulation.value.logs) {
      console.log("\n📋 Logs:");
      simulation.value.logs.forEach((log) => console.log(`   ${log}`));
    }
  } else {
    console.log("✅ Simulation succeeded!");
    console.log(`   Compute units consumed: ${simulation.value.unitsConsumed}`);
  }
}

// ============================================================================
// Run
// ============================================================================

mergeStakeAccountsExample()
  .then(() => {
    console.log("\n✅ Example completed successfully!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n❌ Example failed:", error);
    process.exit(1);
  });
