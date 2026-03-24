/**
 * Example: Mint LST from a Native Stake Account (SIMULATION MODE)
 *
 * This example shows how to:
 * 1. Initialize the Project0Client
 * 2. Fetch a marginfi account and create a wrapper
 * 3. Build a transaction that converts a native stake account into LST tokens
 * 4. Simulate the transaction
 *
 * The mint flow:
 * - Creates LST ATA if needed
 * - Splits the stake account if depositing a partial amount
 * - Authorizes the pool as staker + withdrawer
 * - Deposits stake into the single-validator pool
 * - User receives LST tokens in their ATA
 *
 * Setup:
 * 1. Copy .env.example to .env
 * 2. Fill in your MARGINFI_ACCOUNT_ADDRESS and WALLET_ADDRESS
 * 3. Set STAKE_ACCOUNT_ADDRESS and VALIDATOR_VOTE_ACCOUNT below
 * 4. Run: tsx 12-mint-staked-lst.ts
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

// The native stake account you want to convert to LST
const STAKE_ACCOUNT_ADDRESS = new PublicKey("YOUR_STAKE_ACCOUNT_ADDRESS_HERE");

// The validator vote account that the stake is delegated to
// This must match the validator for the staked bank you're targeting
const VALIDATOR_VOTE_ACCOUNT = new PublicKey("YOUR_VALIDATOR_VOTE_ACCOUNT_HERE");

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

  const connection = getConnection();
  const walletPubkey = getWalletPubkey();
  const config = getMarginfiConfig();

  console.log(`   RPC: ${connection.rpcEndpoint}`);
  console.log(`   Wallet: ${walletPubkey.toBase58()}`);
  console.log(`   Stake Account: ${STAKE_ACCOUNT_ADDRESS.toBase58()}`);
  console.log(`   Validator: ${VALIDATOR_VOTE_ACCOUNT.toBase58()}`);

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
  // Step 4: Build Mint LST Transaction
  // --------------------------------------------------------------------------
  console.log("\n🏗️  Building mint staked LST transaction...");

  const tx = await wrappedAccount.makeMintStakedLstTx(
    MINT_AMOUNT,
    STAKE_ACCOUNT_ADDRESS,
    VALIDATOR_VOTE_ACCOUNT
  );

  console.log(`   Transaction built successfully`);
  console.log(`   Instructions: ${tx.message.compiledInstructions.length}`);
  console.log(`   Signers needed: ${tx.signers?.length ?? 0}`);

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

mintStakedLstExample()
  .then(() => {
    console.log("\n✅ Example completed successfully!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n❌ Example failed:", error);
    process.exit(1);
  });
