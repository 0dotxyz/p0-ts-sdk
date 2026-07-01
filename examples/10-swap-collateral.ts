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
  makeSwapCollateralTx,
  composeBridgedSwap,
  mergeBridgeQuotes,
  resolveBridgeBanks,
  isStandardDepositable,
  isDecomposableSwapError,
  type BridgedSwapLeg,
  type MarginfiAccountType,
} from "../src";
import { Connection, PublicKey } from "@solana/web3.js";
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
  // Step 6: Build Swap Collateral Transaction
  // --------------------------------------------------------------------------
  console.log("\n📝 Building swap collateral transaction...");

  console.log(`   Swapping ${sourceUiAmount.toFixed(6)} ${sourceBank.tokenSymbol || "tokens"}`);
  console.log(`   From bank: ${sourceBank.address.toBase58()}`);
  console.log(`   To bank: ${destinationBank.address.toBase58()}`);

  if (isSameMint) {
    console.log(`   (Same mint - no Jupiter swap needed)`);
  } else {
    console.log(`   From mint: ${sourceBank.mint.toBase58()}`);
    console.log(`   To mint: ${destinationBank.mint.toBase58()}`);
    console.log(`   Slippage: per swap-engine config (see getSwapConfig / .env)`);
  }

  // Get token programs for both banks
  const sourceMintData = await wrappedAccount.getMintDataFromBank(sourceBank);
  const destinationMintData = await wrappedAccount.getMintDataFromBank(destinationBank);

  // Multi-provider swap-engine config (TITAN primary + JUPITER fallback), exactly like the app.
  const swapOpts = { swapConfig: getSwapConfig() };

  // Build the swap. We try the direct single-route build first; if the route won't fit the
  // flashloan tx (size) or can't be quoted, we fall back to a bridged DOUBLE-HOP (A → bridge →
  // C) submitted as one atomic Jito bundle — the same fallback the app performs.
  let transactions;
  let displayQuote; // single-route quote, or the merged quote across the two bridged legs
  let actionTxIndex: number | undefined;
  let isBridged = false;

  try {
    const direct = await wrappedAccount.makeSwapCollateralTx({
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
      assetShareValueMultiplierByBank: client.assetShareValueMultiplierByBank,
      swapOpts,
    });
    transactions = direct.transactions;
    actionTxIndex = direct.actionTxIndex;
    displayQuote = direct.quoteResponse;
    console.log(`✅ Direct swap built (${transactions.length} txs, action index ${actionTxIndex})`);
  } catch (e) {
    // Only a too-big (size) or unquotable route is decomposable into a bridge hop. Anything else
    // (insufficient health, etc.) is a real failure — rethrow. The SDK predicate narrows `e` to a
    // typed TransactionBuildingError (the engine now classifies oversized routes at the source, so
    // there's no raw `encoding overruns` RangeError to message-match anymore).
    if (!isDecomposableSwapError(e)) throw e;
    console.log(`\n⚠️  Direct route didn't fit (${e.code}). Trying a bridged double-hop...`);

    const bridged = await buildBridgedCollateralSwap({
      client,
      wrappedAccount,
      account,
      connection,
      feePayer: walletPubkey,
      sourceBank,
      sourceUiAmount,
      sourceTokenProgram: sourceMintData.tokenProgram,
      destinationBank,
      destinationTokenProgram: destinationMintData.tokenProgram,
    });
    if (!bridged) {
      throw new Error(
        "No bridged route fit either. Try a different pair, a smaller size, or other bridges."
      );
    }
    transactions = bridged.transactions;
    displayQuote = bridged.mergedQuote;
    isBridged = true;
    console.log(`✅ Bridged double-hop built (${transactions.length} txs, 2 legs)`);
  }

  // Quote display
  if (displayQuote) {
    const expectedOutput =
      Number(displayQuote.outAmount) / Math.pow(10, destinationBank.mintDecimals);
    console.log(`\n📈 ${isBridged ? "Merged bridged" : "Swap-engine"} quote:`);
    console.log(
      `   Expected output: ~${expectedOutput.toFixed(6)} ${destinationBank.tokenSymbol || "tokens"}`
    );
    console.log(`   Price impact: ${displayQuote.priceImpactPct ?? "N/A"}%`);
  } else if (isSameMint) {
    console.log(`\n📈 Same mint (no swap needed):`);
    console.log(`   Amount: ${sourceUiAmount.toFixed(6)} ${sourceBank.tokenSymbol || "tokens"}`);
  }

  // --------------------------------------------------------------------------
  // Step 7: Simulate Transaction Bundle
  // --------------------------------------------------------------------------
  console.log("\n🔄 Simulating transaction bundle...");

  try {
    const simulationResults = await simulateBundle(connection.rpcEndpoint, transactions);

    console.log("\n✅ Bundle simulation results:");
    let allSuccessful = true;

    simulationResults.forEach((simResult, index) => {
      const txType = isBridged
        ? `BUNDLE ${index + 1}/${simulationResults.length}`
        : index === actionTxIndex
          ? "SWAP COLLATERAL"
          : actionTxIndex !== undefined && index < actionTxIndex
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
// Bridge double-hop fallback (mirrors the app's tryBridgeCollateralSwap)
// ============================================================================

/**
 * Decompose `source → destination` collateral swap into `source → bridge` + `bridge →
 * destination` through a high-liquidity bridge token, composed into one atomic bundle by the
 * SDK's `composeBridgedSwap`. Returns the bundle + a merged user-facing quote, or null if no
 * bridge candidate fit (caller treats that as a hard failure).
 *
 * Bridge SELECTION is product policy (app-owned in production). Here we hand the universal bridge
 * mints to the SDK's `resolveBridgeBanks`, which picks a standard-depositable bank per mint and
 * skips any the account has an opposite-side (liability) position in — collateral deposits the
 * bridge, and marginfi forbids asset+liability on one bank.
 */
async function buildBridgedCollateralSwap(args: {
  client: Project0Client;
  wrappedAccount: MarginfiAccountWrapper;
  account: MarginfiAccount;
  connection: Connection;
  feePayer: PublicKey;
  sourceBank: Bank;
  sourceUiAmount: number;
  sourceTokenProgram: PublicKey;
  destinationBank: Bank;
  destinationTokenProgram: PublicKey;
}) {
  const { client, wrappedAccount, account, connection, feePayer } = args;
  const { sourceBank, sourceUiAmount, sourceTokenProgram } = args;
  const { destinationBank, destinationTokenProgram } = args;

  const swapOpts = { swapConfig: getSwapConfig() };

  // Universal bridge mints (high liquidity); never bridge through the source/destination itself.
  const orderedBridgeMints = UNIVERSAL_BRIDGE_MINTS.filter(
    (m) => !m.equals(sourceBank.mint) && !m.equals(destinationBank.mint)
  );

  // Let the SDK resolve mints → standard-depositable banks and drop opposite-side conflicts.
  const { bridges } = resolveBridgeBanks({
    orderedBridgeMints,
    banks: client.banks,
    marginfiAccount: account,
    side: "deposit",
  });

  for (const bridgeBank of bridges) {
    const bridgeMintData = await wrappedAccount.getMintDataFromBank(bridgeBank);

    // Leg 1: source → bridge, built against the real account.
    const leg1 = await wrappedAccount.makeSwapCollateralTx({
      connection,
      withdrawOpts: {
        totalPositionAmount: sourceUiAmount,
        withdrawBank: sourceBank,
        tokenProgram: sourceTokenProgram,
      },
      depositOpts: { depositBank: bridgeBank, tokenProgram: bridgeMintData.tokenProgram },
      assetShareValueMultiplierByBank: client.assetShareValueMultiplierByBank,
      swapOpts,
    });
    if (!leg1.quoteResponse) continue; // need a quote to size leg 2

    const firstLeg: BridgedSwapLeg = {
      transactions: leg1.transactions,
      quoteResponse: leg1.quoteResponse,
    };

    // Size leg 2 from leg 1's GUARANTEED bridge output (min-out), so first-leg slippage can't make
    // leg 2 attempt to withdraw more bridge than actually arrived.
    const bridgeUiAmount =
      Number(leg1.quoteResponse.otherAmountThreshold) / Math.pow(10, bridgeBank.mintDecimals);

    // Leg 2: bridge → destination, built against the account AFTER leg 1. composeBridgedSwap
    // replays leg 1's effect onto a clone and passes us that projected account.
    const buildSecondLeg = async (
      projectedAccount: MarginfiAccountType
    ): Promise<BridgedSwapLeg> => {
      const leg2 = await makeSwapCollateralTx({
        program: client.program,
        marginfiAccount: projectedAccount,
        connection,
        bankMap: client.bankMap,
        oraclePrices: client.oraclePriceByBank,
        assetShareValueMultiplierByBank: client.assetShareValueMultiplierByBank,
        bankMetadataMap: client.bankIntegrationMap,
        withdrawOpts: {
          totalPositionAmount: bridgeUiAmount,
          withdrawBank: bridgeBank,
          tokenProgram: bridgeMintData.tokenProgram,
        },
        depositOpts: { depositBank: destinationBank, tokenProgram: destinationTokenProgram },
        swapOpts,
        addressLookupTableAccounts: client.addressLookupTables,
      });
      return { transactions: leg2.transactions, quoteResponse: leg2.quoteResponse };
    };

    const composed = await composeBridgedSwap({
      firstLeg,
      buildSecondLeg,
      marginfiAccount: account,
      program: client.program,
      banksMap: client.bankMap,
      assetShareValueMultiplierByBank: client.assetShareValueMultiplierByBank,
      feePayer,
    });
    if (!composed) continue; // bundle didn't fit (e.g. > 5 txs) → try the next bridge

    console.log(
      `   ✅ Bridged via ${bridgeBank.tokenSymbol ?? bridgeBank.mint.toBase58()}: ` +
        `${sourceBank.tokenSymbol ?? "src"} → ${bridgeBank.tokenSymbol ?? "bridge"} → ` +
        `${destinationBank.tokenSymbol ?? "dst"}`
    );
    return {
      transactions: composed.transactions,
      mergedQuote: mergeBridgeQuotes(composed.firstLegQuote, composed.secondLegQuote),
    };
  }

  return null;
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
