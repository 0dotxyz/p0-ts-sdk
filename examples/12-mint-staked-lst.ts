/**
 * Example: Mint LST from a Native Stake Account (SIMULATION MODE)
 *
 * This example shows how to:
 * 1. Build a transaction that converts a native stake account into LST tokens
 * 2. Simulate the transaction
 *
 * The mint flow:
 * - Creates the LST ATA if needed
 * - Splits the stake account into a new stake account if depositing a partial amount
 * - Authorizes the pool as staker + withdrawer
 * - Deposits stake into the single-validator pool
 * - User receives LST tokens in their ATA
 *
 * Setup:
 * 1. Copy .env.example to .env
 * 2. Fill in WALLET_ADDRESS (the stake account's staker and withdrawer)
 * 3. Set STAKE_ACCOUNT_ADDRESS and VALIDATOR_VOTE_ACCOUNT below
 * 4. Run: tsx 12-mint-staked-lst.ts
 *
 * Note: This runs in SIMULATION mode - no actual transactions are sent. The authority is a noop
 * signer for WALLET_ADDRESS; use your wallet's signer and `signTransactionMessageWithSigners` to
 * send for real (the split account's generated signer is already in the message).
 */

import {
  address,
  compileTransaction,
  createNoopSigner,
  getBase64EncodedWireTransaction,
  getSignersFromTransactionMessage,
} from "@solana/kit";

import { makeMintStakedLstTx } from "../src";
import { getRpc, getWalletAddress } from "./config";

// ============================================================================
// Configuration
// ============================================================================

// The native stake account you want to convert to LST
const STAKE_ACCOUNT_ADDRESS = address("YOUR_STAKE_ACCOUNT_ADDRESS_HERE");

// The validator vote account that the stake is delegated to
// This must match the validator for the staked bank you're targeting
const VALIDATOR_VOTE_ACCOUNT = address("YOUR_VALIDATOR_VOTE_ACCOUNT_HERE");

// Amount of SOL to convert to LST (in UI units)
// Set to a large number to convert the full stake account
const MINT_AMOUNT = "1.0";

// ============================================================================
// Main Example
// ============================================================================

async function mintStakedLstExample() {
  // --------------------------------------------------------------------------
  // Step 1: Load Configuration
  // --------------------------------------------------------------------------
  console.log("\n🔧 Loading configuration...");

  const { rpc, rpcEndpoint } = getRpc();
  const authority = createNoopSigner(getWalletAddress());

  console.log(`   RPC: ${rpcEndpoint}`);
  console.log(`   Wallet: ${authority.address}`);
  console.log(`   Stake Account: ${STAKE_ACCOUNT_ADDRESS}`);
  console.log(`   Validator: ${VALIDATOR_VOTE_ACCOUNT}`);

  // --------------------------------------------------------------------------
  // Step 2: Build Mint LST Transaction
  // --------------------------------------------------------------------------
  console.log("\n🏗️  Building mint staked LST transaction...");

  const tx = await makeMintStakedLstTx({
    rpc,
    authority,
    amount: MINT_AMOUNT,
    stakeAccount: STAKE_ACCOUNT_ADDRESS,
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

mintStakedLstExample()
  .then(() => {
    console.log("\n✅ Example completed successfully!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n❌ Example failed:", error);
    process.exit(1);
  });
