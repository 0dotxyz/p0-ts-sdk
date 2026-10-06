/**
 * Example: Withdraw tokens from a bank
 *
 * This example shows how to:
 * 1. Initialize the Project0Client from config
 * 2. Fetch a marginfi account
 * 3. Check lending balances (deposits)
 * 4. Find the first position with a balance
 * 5. Calculate max withdraw capacity
 * 6. Build and simulate withdraw transaction
 *
 * Setup:
 * 1. Copy .env.example to .env
 * 2. Fill in your configuration values
 * 3. Run: tsx 03-withdraw.ts
 */

import { compileTransaction, getBase64EncodedWireTransaction } from "@solana/kit";

import { Project0Client, AssetTag } from "../src";
import { getRpc, getMarginfiConfig, getAccountAddress } from "./config";

// ============================================================================
// Configuration
// ============================================================================

const WITHDRAW_ALL = false; // Set to true to withdraw entire position
const WITHDRAW_PERCENTAGE = 0.1; // Withdraw 10% of available balance

// ============================================================================
// Main Example
// ============================================================================

async function withdrawExample() {
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
  // Step 4: Find First Lending Position
  // --------------------------------------------------------------------------
  console.log("\n💰 Checking lending balances...");

  // Get all active lending positions (deposits)
  const lendingBalances = account.balances.filter(
    (balance) => balance.active && !balance.assetShares.isZero()
  );

  console.log(`   Found ${lendingBalances.length} active lending position(s)`);

  if (lendingBalances.length === 0) {
    throw new Error("No lending positions found. Deposit some tokens first.");
  }

  // Use the first lending position
  const firstBalance = lendingBalances[0];
  const bankAddress = firstBalance.bankPk;
  const bank = client.getBank(bankAddress);

  if (!bank) {
    throw new Error(`Bank ${bankAddress} not found`);
  }

  // Token amount (UI units) from shares; the multiplier converts Kamino/Drift/JupLend shares
  const uiAmount = firstBalance.computeQuantityUi(
    bank,
    client.assetShareValueMultiplierByBank.get(bank.address)
  ).assets;

  console.log(`\n✅ Selected first lending position:`);
  console.log(`   Bank: ${bank.address}`);
  console.log(`   Mint: ${bank.mint}`);
  console.log(`   Balance: ${uiAmount.toFixed(6)} tokens`);

  // --------------------------------------------------------------------------
  // Step 5: Check Withdraw Capacity
  // --------------------------------------------------------------------------
  console.log("\n📊 Checking withdraw capacity...");

  const maxWithdraw = wrappedAccount.computeMaxWithdrawForBank(bank.address);
  console.log(`   Max withdraw: ${maxWithdraw.toString()} tokens`);

  // Calculate actual withdraw amount (percentage of balance)
  const withdrawAmount = Math.min(
    uiAmount.toNumber() * WITHDRAW_PERCENTAGE,
    maxWithdraw.toNumber()
  ).toString();

  console.log(
    `   Withdrawing: ${withdrawAmount} tokens (${WITHDRAW_PERCENTAGE * 100}% of balance)`
  );

  // --------------------------------------------------------------------------
  // Step 6: Build Withdraw Transaction
  // --------------------------------------------------------------------------
  // One builder for every bank kind: Kamino, Drift and JupLend banks get their venue withdraw and
  // refresh instructions from the client's integration state.
  console.log(`\n📝 Building withdraw transaction...`);
  console.log(`   Asset tag: ${AssetTag[bank.config.assetTag]}`);

  const withdrawTx = await wrappedAccount.makeWithdrawTx(bank.address, withdrawAmount, WITHDRAW_ALL);

  console.log(`✅ Transaction built successfully`);

  // --------------------------------------------------------------------------
  // Step 7: Simulate Transaction
  // --------------------------------------------------------------------------
  console.log("\n🔄 Simulating transaction...");

  const wireTransaction = getBase64EncodedWireTransaction(compileTransaction(withdrawTx.message));

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

withdrawExample()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n❌ Error:", error);
    process.exit(1);
  });
