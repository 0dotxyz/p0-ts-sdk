/**
 * Example: Redeem LST back to a Native Stake Account (SIMULATION MODE)
 *
 * This example shows how to:
 * 1. Build a transaction that converts LST tokens back to a native stake account
 * 2. Simulate the transaction
 *
 * The redeem flow:
 * - Creates a new stake account (rent-exempt)
 * - Approves the pool mint authority to burn LST tokens
 * - Withdraws stake from the pool into the new stake account
 *
 * Setup:
 * 1. Copy .env.example to .env
 * 2. Fill in WALLET_ADDRESS (holds the LST)
 * 3. Set VALIDATOR_VOTE_ACCOUNT below
 * 4. Run: tsx 13-redeem-staked-lst.ts
 *
 * Note: This runs in SIMULATION mode - no actual transactions are sent. The authority is a noop
 * signer for WALLET_ADDRESS; use your wallet's signer and `signTransactionMessageWithSigners` to
 * send for real (the new stake account's generated signer is already in the message).
 */

import {
  address,
  compileTransaction,
  createNoopSigner,
  getBase64EncodedWireTransaction,
  getSignersFromTransactionMessage,
} from "@solana/kit";

import { makeRedeemStakedLstTx } from "../src";
import { getRpc, getWalletAddress } from "./config";

// ============================================================================
// Configuration
// ============================================================================

// The validator vote account for the LST you want to redeem
const VALIDATOR_VOTE_ACCOUNT = address("YOUR_VALIDATOR_VOTE_ACCOUNT_HERE");

// Amount of LST to redeem (in UI units)
const REDEEM_AMOUNT = "1.0";

// ============================================================================
// Main Example
// ============================================================================

async function redeemStakedLstExample() {
  // --------------------------------------------------------------------------
  // Step 1: Load Configuration
  // --------------------------------------------------------------------------
  console.log("\n🔧 Loading configuration...");

  const { rpc, rpcEndpoint } = getRpc();
  const authority = createNoopSigner(getWalletAddress());

  console.log(`   RPC: ${rpcEndpoint}`);
  console.log(`   Wallet: ${authority.address}`);
  console.log(`   Validator: ${VALIDATOR_VOTE_ACCOUNT}`);

  // --------------------------------------------------------------------------
  // Step 2: Build Redeem LST Transaction
  // --------------------------------------------------------------------------
  console.log("\n🏗️  Building redeem staked LST transaction...");

  const tx = await makeRedeemStakedLstTx({
    rpc,
    authority,
    amount: REDEEM_AMOUNT,
    validator: VALIDATOR_VOTE_ACCOUNT,
    luts: {},
  });

  console.log(`   Transaction built successfully`);
  console.log(`   Instructions: ${tx.message.instructions.length}`);
  console.log(`   Signers: ${getSignersFromTransactionMessage(tx.message).length}`);

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

redeemStakedLstExample()
  .then(() => {
    console.log("\n✅ Example completed successfully!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n❌ Example failed:", error);
    process.exit(1);
  });
