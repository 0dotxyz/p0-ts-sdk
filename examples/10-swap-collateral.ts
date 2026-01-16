/**
 * Example: Swap collateral from one type to another (SIMULATION MODE)
 *
 * This example shows how to:
 * 1. Initialize the Project0Client from config
 * 2. Fetch a marginfi account
 * 3. Find an existing collateral position
 * 4. Build a swap collateral transaction (source collateral -> destination collateral)
 * 5. Simulate the transaction bundle
 *
 * The swap is executed via flash loan, so account health is not affected during the swap.
 *
 * Setup:
 * 1. Copy .env.example to .env
 * 2. Fill in your configuration values
 * 3. Run: tsx 10-swap-collateral.ts
 *
 * Note: This runs in SIMULATION mode - no actual transactions are sent.
 */

import {
  Project0Client,
  MarginfiAccountWrapper,
  MarginfiAccount,
  simulateBundle,
  Bank,
} from "../src";
import { PublicKey } from "@solana/web3.js";
import {
  getConnection,
  getMarginfiConfig,
  getAccountAddress,
  getWalletPubkey,
  MINTS,
} from "./config";

// ============================================================================
// Configuration - Edit these to test different scenarios
// ============================================================================

// Source collateral: null = use first active collateral position
const SOURCE_MINT: PublicKey | null = null;

// Destination collateral: the mint to swap into
const DESTINATION_MINT = MINTS.USDC;

// Jupiter swap options
const SLIPPAGE_MODE: "DYNAMIC" | "FIXED" = "DYNAMIC";
const SLIPPAGE_BPS = 50; // 0.5% slippage
const PLATFORM_FEE_BPS = 0;
const DIRECT_ROUTES_ONLY = false;

// ============================================================================
// Main Example
// ============================================================================

async function swapCollateralExample() {
  // --------------------------------------------------------------------------
  // Step 1: Load Configuration
  // --------------------------------------------------------------------------
  console.log("\n🔧 Loading configuration...");

  const connection = getConnection();
  const walletPubkey = getWalletPubkey();
  const config = getMarginfiConfig();

  console.log(`   RPC: ${connection.rpcEndpoint}`);
  console.log(`   Environment: ${config.environment}`);
  console.log(`   Wallet: ${walletPubkey.toBase58()}`);

  // --------------------------------------------------------------------------
  // Step 2: Initialize Client
  // --------------------------------------------------------------------------
  console.log("\n📡 Initializing Project0Client...");

  const client = await Project0Client.initialize(connection, config);

  console.log(`✅ Client initialized`);
  console.log(`📊 Loaded ${client.banks.length} banks`);

  // --------------------------------------------------------------------------
  // Step 3: Load Marginfi Account
  // --------------------------------------------------------------------------
  console.log("\n👤 Loading marginfi account...");

  const accountAddress = getAccountAddress();
  const account = await MarginfiAccount.fetch(accountAddress, client.program);
  const wrappedAccount = new MarginfiAccountWrapper(account, client);

  console.log(`✅ Account loaded: ${account.address.toBase58()}`);

  // --------------------------------------------------------------------------
  // Step 4: Find Source Collateral Position
  // --------------------------------------------------------------------------
  console.log("\n💰 Checking collateral positions...");

  // Get all active collateral positions (deposits with asset shares > 0)
  const collateralBalances = account.balances.filter(
    (balance) => balance.active && !balance.assetShares.isZero()
  );

  console.log(`   Found ${collateralBalances.length} active collateral position(s)`);

  if (collateralBalances.length === 0) {
    throw new Error("No collateral positions found. Deposit some tokens first using 01-deposit.ts");
  }

  // Find the source bank (either by mint or use first position)
  let sourceBank: Bank | undefined;
  let sourceBalance;

  if (SOURCE_MINT) {
    // Find balance matching the specified mint
    for (const balance of collateralBalances) {
      const bank = client.bankMap.get(balance.bankPk.toBase58());
      if (bank && bank.mint.equals(SOURCE_MINT)) {
        sourceBank = bank;
        sourceBalance = balance;
        break;
      }
    }
    if (!sourceBank) {
      throw new Error(`No collateral position found for mint: ${SOURCE_MINT.toBase58()}`);
    }
  } else {
    // Use first collateral position
    sourceBalance = collateralBalances[0];
    sourceBank = client.bankMap.get(sourceBalance.bankPk.toBase58());
    if (!sourceBank) {
      throw new Error(`Bank not found: ${sourceBalance.bankPk.toBase58()}`);
    }
  }

  // Calculate the token amount from shares
  const sourceTokenAmount = sourceBank.getAssetQuantity(sourceBalance.assetShares);
  const sourceUiAmount = sourceTokenAmount.div(Math.pow(10, sourceBank.mintDecimals)).toNumber();

  console.log(`\n✅ Source collateral selected:`);
  console.log(`   Bank: ${sourceBank.address.toBase58()}`);
  console.log(`   Symbol: ${sourceBank.tokenSymbol || "Unknown"}`);
  console.log(`   Mint: ${sourceBank.mint.toBase58()}`);
  console.log(`   Balance: ${sourceUiAmount.toFixed(6)} tokens`);

  // --------------------------------------------------------------------------
  // Step 5: Find Destination Bank
  // --------------------------------------------------------------------------
  console.log("\n🏦 Selecting destination bank...");

  // Find a bank for the destination mint
  const destinationBanks = client.banks.filter((bank) => bank.mint.equals(DESTINATION_MINT));

  if (destinationBanks.length === 0) {
    throw new Error(`No bank found for destination mint: ${DESTINATION_MINT.toBase58()}`);
  }

  const destinationBank = destinationBanks[0];

  console.log(`✅ Destination bank selected:`);
  console.log(`   Bank: ${destinationBank.address.toBase58()}`);
  console.log(`   Symbol: ${destinationBank.tokenSymbol || "Unknown"}`);
  console.log(`   Mint: ${destinationBank.mint.toBase58()}`);

  // Check if source and destination are the same
  if (sourceBank.mint.equals(destinationBank.mint)) {
    console.log("\n⚠️  Source and destination mints are the same - no swap needed.");
    return;
  }

  // --------------------------------------------------------------------------
  // Step 6: Build Swap Collateral Transaction
  // --------------------------------------------------------------------------
  console.log("\n📝 Building swap collateral transaction...");
  console.log(`   Swapping ${sourceUiAmount.toFixed(6)} ${sourceBank.tokenSymbol || "tokens"}`);
  console.log(`   From: ${sourceBank.mint.toBase58()}`);
  console.log(`   To: ${destinationBank.mint.toBase58()}`);
  console.log(`   Slippage: ${SLIPPAGE_MODE === "DYNAMIC" ? "Dynamic" : `${SLIPPAGE_BPS / 100}%`}`);

  // Get token programs for both banks
  const sourceMintData = await wrappedAccount.getMintDataFromBank(sourceBank);
  const destinationMintData = await wrappedAccount.getMintDataFromBank(destinationBank);

  const result = await wrappedAccount.makeSwapCollateralTx({
    connection,
    withdrawOpts: {
      totalPositionAmount: sourceUiAmount,
      withdrawBank: sourceBank,
      tokenProgram: sourceMintData.tokenProgram,
    },
    depositOpts: {
      depositBank: destinationBank,
      tokenProgram: destinationMintData.tokenProgram,
    },
    swapOpts: {
      jupiterOptions: {
        slippageMode: SLIPPAGE_MODE,
        slippageBps: SLIPPAGE_BPS,
        platformFeeBps: PLATFORM_FEE_BPS,
        directRoutesOnly: DIRECT_ROUTES_ONLY,
      },
    },
  });

  console.log(`✅ Transaction built successfully`);
  console.log(`   Total transactions: ${result.transactions.length}`);
  console.log(`   Action transaction index: ${result.actionTxIndex}`);

  if (result.quoteResponse) {
    const expectedOutput =
      Number(result.quoteResponse.outAmount) / Math.pow(10, destinationBank.mintDecimals);
    console.log(`\n📈 Jupiter quote:`);
    console.log(
      `   Expected output: ~${expectedOutput.toFixed(6)} ${destinationBank.tokenSymbol || "tokens"}`
    );
    console.log(`   Price impact: ${result.quoteResponse.priceImpactPct || "N/A"}%`);
  }

  // --------------------------------------------------------------------------
  // Step 7: Simulate Transaction Bundle
  // --------------------------------------------------------------------------
  console.log("\n🔄 Simulating transaction bundle...");

  try {
    const simulationResults = await simulateBundle(connection.rpcEndpoint, result.transactions);

    console.log("\n✅ Bundle simulation results:");
    let allSuccessful = true;

    simulationResults.forEach((simResult, index) => {
      const txType =
        index === result.actionTxIndex
          ? "SWAP COLLATERAL"
          : index < result.actionTxIndex
            ? "SETUP"
            : "CLEANUP";

      console.log(`\n   Transaction ${index + 1} (${txType}):`);

      if (simResult.err) {
        allSuccessful = false;
        console.log(`   ❌ Error: ${JSON.stringify(simResult.err)}`);
        if (simResult.logs && simResult.logs.length > 0) {
          console.log(`   Logs:`);
          simResult.logs.slice(-5).forEach((log) => console.log(`     ${log}`));
        }
      } else {
        console.log(`   ✅ Success`);
        console.log(`   Compute units: ${simResult.unitsConsumed || "N/A"}`);
      }
    });

    if (allSuccessful) {
      console.log("\n✅ All transactions simulated successfully!");
      console.log(
        "\n💡 To execute this swap, you would sign and send these transactions in order."
      );
    } else {
      console.log("\n⚠️  Some transactions failed simulation. Check errors above.");
    }
  } catch (error) {
    console.error("\n❌ Simulation error:", error);
    throw error;
  }
}

// ============================================================================
// Run Example
// ============================================================================

swapCollateralExample()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n❌ Error:", error);
    process.exit(1);
  });
