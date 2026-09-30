/**
 * Example: Merge Two Stake Accounts (SIMULATION MODE)
 *
 * This example shows how to:
 * 1. Build a transaction that merges two native stake accounts into one
 * 2. Simulate the transaction
 *
 * Prerequisites:
 * - Both stake accounts must share the same authorized staker and withdrawer
 * - Both must be delegated to the same validator vote account
 * - Both must be in the "active" state
 *
 * Setup:
 * 1. Copy .env.example to .env
 * 2. Fill in WALLET_ADDRESS (the stake authority of both accounts)
 * 3. Set SOURCE_STAKE_ACCOUNT and DESTINATION_STAKE_ACCOUNT below
 * 4. Run: tsx 14-merge-stake-accounts.ts
 *
 * Note: This runs in SIMULATION mode - no actual transactions are sent.
 */

import {
  address,
  compileTransaction,
  createNoopSigner,
  getBase64EncodedWireTransaction,
} from "@solana/kit";

import { makeMergeStakeAccountsTx } from "../src";
import { getRpc, getWalletAddress } from "./config";

// ============================================================================
// Configuration
// ============================================================================

// The stake account to merge FROM (will be consumed)
const SOURCE_STAKE_ACCOUNT = address("YOUR_SOURCE_STAKE_ACCOUNT_HERE");

// The stake account to merge INTO (will receive the combined balance)
const DESTINATION_STAKE_ACCOUNT = address("YOUR_DESTINATION_STAKE_ACCOUNT_HERE");

// ============================================================================
// Main Example
// ============================================================================

async function mergeStakeAccountsExample() {
  // --------------------------------------------------------------------------
  // Step 1: Load Configuration
  // --------------------------------------------------------------------------
  console.log("\n🔧 Loading configuration...");

  const { rpc, rpcEndpoint } = getRpc();
  const authority = createNoopSigner(getWalletAddress());

  console.log(`   RPC: ${rpcEndpoint}`);
  console.log(`   Wallet: ${authority.address}`);
  console.log(`   Source: ${SOURCE_STAKE_ACCOUNT}`);
  console.log(`   Destination: ${DESTINATION_STAKE_ACCOUNT}`);

  // --------------------------------------------------------------------------
  // Step 2: Build Merge Transaction
  // --------------------------------------------------------------------------
  console.log("\n🏗️  Building merge stake accounts transaction...");

  const tx = await makeMergeStakeAccountsTx({
    rpc,
    authority,
    sourceStakeAccount: SOURCE_STAKE_ACCOUNT,
    destinationStakeAccount: DESTINATION_STAKE_ACCOUNT,
    luts: {},
  });

  console.log(`   Transaction built successfully`);
  console.log(`   Instructions: ${tx.message.instructions.length}`);

  // --------------------------------------------------------------------------
  // Step 3: Simulate Transaction
  // --------------------------------------------------------------------------
  console.log("\n🔍 Simulating transaction...");

  const simulation = await rpc
    .simulateTransaction(getBase64EncodedWireTransaction(compileTransaction(tx.message)), {
      encoding: "base64",
      sigVerify: false,
      replaceRecentBlockhash: true,
    })
    .send();

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
