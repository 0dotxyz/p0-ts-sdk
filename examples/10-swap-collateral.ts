/**
 * Example: Swap collateral from one type to another (SIMULATION MODE)
 *
 * This example shows how to:
 * 1. Initialize the Project0Client from config
 * 2. Fetch a marginfi account
 * 3. Find an existing collateral position
 * 4. Build the swap in ONE call with `makeBridgedSwapCollateralTx` — it tries the direct
 *    single-route swap first and transparently falls back to a bridged DOUBLE-HOP
 *    (source → bridge token → destination) as one atomic Jito bundle when the direct route
 *    doesn't fit one transaction or can't be quoted
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
  isStandardDepositable,
  isBridgeConflictError,
} from "../src";
import { PublicKey } from "@solana/web3.js";
import {
  getConnection,
  getMarginfiConfig,
  getAccountAddress,
  getWalletPubkey,
  getSwapConfig,
  MINTS,
  UNIVERSAL_BRIDGE_MINTS,
} from "./config";

// ============================================================================
// Configuration - Edit these to test different scenarios
// ============================================================================

// Source collateral: null = use first active collateral position (override with SOURCE_MINT env)
const SOURCE_MINT: PublicKey | null = process.env.SOURCE_MINT
  ? new PublicKey(process.env.SOURCE_MINT)
  : null;

// Destination collateral: the mint to swap into (override with DESTINATION_MINT env)
const DESTINATION_MINT = process.env.DESTINATION_MINT
  ? new PublicKey(process.env.DESTINATION_MINT)
  : MINTS.SOL;

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

  if (!sourceBalance) {
    throw new Error("Failed to resolve source collateral balance");
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

  // Find a depositable bank for the destination mint. isStandardDepositable encodes the on-chain
  // invariant: only DEFAULT/SOL asset-tag, Operational banks accept deposits (excludes ReduceOnly
  // banks and Kamino/Drift/JupLend wrappers — depositing into those reverts with 6017/6200).
  const destinationBanks = client.banks.filter(
    (bank) => bank.mint.equals(DESTINATION_MINT) && isStandardDepositable(bank)
  );

  if (destinationBanks.length === 0) {
    throw new Error(
      `No depositable bank found for destination mint: ${DESTINATION_MINT.toBase58()}`
    );
  }

  const destinationBank = destinationBanks[0];

  console.log(`✅ Destination bank selected:`);
  console.log(`   Bank: ${destinationBank.address.toBase58()}`);
  console.log(`   Symbol: ${destinationBank.tokenSymbol || "Unknown"}`);
  console.log(`   Mint: ${destinationBank.mint.toBase58()}`);

  // Check if source and destination banks are the same
  if (sourceBank.address.equals(destinationBank.address)) {
    console.log("\n⚠️  Source and destination banks are the same - nothing to do.");
    return;
  }

  // Determine if this is a swap (different mints) or transfer (same mint, different banks)
  const isSameMint = sourceBank.mint.equals(destinationBank.mint);

  // --------------------------------------------------------------------------
  // Step 6: Build Swap Collateral Transaction (direct, with bridged fallback)
  // --------------------------------------------------------------------------
  console.log("\n📝 Building swap collateral transaction...");

  console.log(`   Swapping ${sourceUiAmount.toFixed(6)} ${sourceBank.tokenSymbol || "tokens"}`);
  console.log(`   From bank: ${sourceBank.address.toBase58()}`);
  console.log(`   To bank: ${destinationBank.address.toBase58()}`);

  if (isSameMint) {
    console.log(`   (Same mint - no swap needed)`);
  } else {
    console.log(`   From mint: ${sourceBank.mint.toBase58()}`);
    console.log(`   To mint: ${destinationBank.mint.toBase58()}`);
    console.log(`   Slippage: per swap-engine config (see getSwapConfig / .env)`);
  }

  // Get token programs for both banks
  const sourceMintData = await wrappedAccount.getMintDataFromBank(sourceBank);
  const destinationMintData = await wrappedAccount.getMintDataFromBank(destinationBank);

  // ONE call builds the whole thing. The SDK tries the direct single-route swap first; if the
  // route won't fit the flashloan tx (size / account-locks) or can't be quoted, it transparently
  // decomposes into `source → bridge token → destination` — two legs composed as one atomic Jito
  // bundle — walking the bridge candidates in priority order. `bridgeOpts` is optional (defaults
  // to USDC → wSOL → USDT); we pass the example's universal list to also try JitoSOL.
  const result = await wrappedAccount
    .makeBridgedSwapCollateralTx({
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
      swapOpts: { swapConfig: getSwapConfig() },
      bridgeOpts: { bridgeCandidateMints: UNIVERSAL_BRIDGE_MINTS },
    })
    .catch((e) => {
      // BRIDGE_CONFLICT means the direct route failed AND every bridge candidate is blocked by an
      // opposite-side position (a token can't be both collateral and debt on one bank). Any other
      // error is the direct build's failure (health, size with no bridge fitting, etc.).
      if (isBridgeConflictError(e)) {
        const blocked = e.details.conflictingBanks.map((b) => b.symbol ?? b.mint).join(", ");
        throw new Error(
          `Swap must route through ${blocked}, but the account already borrows them. ` +
            `Close that position or pick a different pair.`
        );
      }
      throw e;
    });

  const isBridged = result.bridgeMint !== undefined;
  if (isBridged) {
    const bridgeBank = client.banks.find((b) => b.mint.equals(result.bridgeMint!));
    console.log(
      `✅ Direct route didn't fit — bridged double-hop built via ` +
        `${bridgeBank?.tokenSymbol ?? result.bridgeMint!.toBase58()} (${result.transactions.length} txs, 2 legs)`
    );
  } else {
    console.log(
      `✅ Direct swap built (${result.transactions.length} txs, action index ${result.actionTxIndex})`
    );
  }

  // Quote display (direct single-route quote, or the merged quote across the two bridged legs)
  if (result.quoteResponse) {
    const expectedOutput =
      Number(result.quoteResponse.outAmount) / Math.pow(10, destinationBank.mintDecimals);
    console.log(`\n📈 ${isBridged ? "Merged bridged" : "Swap-engine"} quote:`);
    console.log(
      `   Expected output: ~${expectedOutput.toFixed(6)} ${destinationBank.tokenSymbol || "tokens"}`
    );
    console.log(`   Price impact: ${result.quoteResponse.priceImpactPct ?? "N/A"}%`);
  } else if (isSameMint) {
    console.log(`\n📈 Same mint (no swap needed):`);
    console.log(`   Amount: ${sourceUiAmount.toFixed(6)} ${sourceBank.tokenSymbol || "tokens"}`);
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
      const txType = isBridged
        ? `BUNDLE ${index + 1}/${simulationResults.length}`
        : index === result.actionTxIndex
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
        "\n💡 To execute this swap, you would sign and send these transactions in order" +
          (isBridged ? " as ONE atomic Jito bundle (both legs)." : ".")
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
