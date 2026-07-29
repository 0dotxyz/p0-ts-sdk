/**
 * Example: Swap debt from one type to another (SIMULATION MODE)
 *
 * This example shows how to:
 * 1. Initialize the Project0Client from config
 * 2. Fetch a marginfi account
 * 3. Find an existing debt position
 * 4. Build the swap in ONE call with `makeBridgedSwapDebtTx` — it tries the direct single-route
 *    swap first and transparently falls back to a bridged DOUBLE-HOP (repay source → borrow
 *    bridge token, then repay bridge → borrow destination) as one atomic Jito bundle when the
 *    direct route doesn't fit one transaction or can't be quoted
 * 5. Simulate the transaction bundle
 *
 * The swap is executed via flash loan, so account health is not affected during the swap.
 * Flow: Borrow new debt -> swap -> Repay old debt
 *
 * Setup:
 * 1. Copy .env.example to .env
 * 2. Fill in your configuration values
 * 3. Run: tsx 11-swap-debt.ts
 *
 * Note: This runs in SIMULATION mode - no actual transactions are sent.
 */

import {
  Project0Client,
  MarginfiAccountWrapper,
  MarginfiAccount,
  simulateBundle,
  Bank,
  isStandardBorrowable,
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

// Source debt: null = use first active debt position (override with SOURCE_MINT env)
const SOURCE_MINT: PublicKey | null = process.env.SOURCE_MINT
  ? new PublicKey(process.env.SOURCE_MINT)
  : null;

// Destination debt: the mint to swap into, becomes your new debt (override with DESTINATION_MINT env)
const DESTINATION_MINT = process.env.DESTINATION_MINT
  ? new PublicKey(process.env.DESTINATION_MINT)
  : MINTS.SOL;

// ============================================================================
// Main Example
// ============================================================================

async function swapDebtExample() {
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
  // Step 4: Find Source Debt Position
  // --------------------------------------------------------------------------
  console.log("\n💳 Checking debt positions...");

  // Get all active debt positions (borrows with liability shares > 0)
  const debtBalances = account.balances.filter(
    (balance) => balance.active && !balance.liabilityShares.isZero()
  );

  console.log(`   Found ${debtBalances.length} active debt position(s)`);

  if (debtBalances.length === 0) {
    throw new Error("No debt positions found. Borrow some tokens first using 02-borrow.ts");
  }

  // Find the source bank (either by mint or use first position)
  let sourceBank: Bank | undefined;
  let sourceBalance;

  if (SOURCE_MINT) {
    // Find balance matching the specified mint
    for (const balance of debtBalances) {
      const bank = client.bankMap.get(balance.bankPk.toBase58());
      if (bank && bank.mint.equals(SOURCE_MINT)) {
        sourceBank = bank;
        sourceBalance = balance;
        break;
      }
    }
    if (!sourceBank) {
      throw new Error(`No debt position found for mint: ${SOURCE_MINT.toBase58()}`);
    }
  } else {
    // Use first debt position
    sourceBalance = debtBalances[0];
    sourceBank = client.bankMap.get(sourceBalance.bankPk.toBase58());
    if (!sourceBank) {
      throw new Error(`Bank not found: ${sourceBalance.bankPk.toBase58()}`);
    }
  }

  if (!sourceBalance) {
    throw new Error("Failed to resolve source debt balance");
  }

  // Calculate the token amount from liability shares
  const sourceTokenAmount = sourceBank.getLiabilityQuantity(sourceBalance.liabilityShares);
  const sourceUiAmount = sourceTokenAmount.div(Math.pow(10, sourceBank.mintDecimals)).toNumber();

  console.log(`\n✅ Source debt selected:`);
  console.log(`   Bank: ${sourceBank.address.toBase58()}`);
  console.log(`   Symbol: ${sourceBank.tokenSymbol || "Unknown"}`);
  console.log(`   Mint: ${sourceBank.mint.toBase58()}`);
  console.log(`   Debt: ${sourceUiAmount.toFixed(6)} tokens`);

  // --------------------------------------------------------------------------
  // Step 5: Find Destination Bank
  // --------------------------------------------------------------------------
  console.log("\n🏦 Selecting destination bank...");

  // Find a borrowable P0 bank for the destination mint. isStandardBorrowable encodes the on-chain
  // invariant: only DEFAULT/SOL asset-tag, Operational banks with a borrow limit can be borrowed
  // (excludes Kamino/Drift/JupLend wrappers and ReduceOnly banks).
  const destinationBanks = client.banks.filter(
    (bank) => bank.mint.equals(DESTINATION_MINT) && isStandardBorrowable(bank)
  );

  if (destinationBanks.length === 0) {
    throw new Error(
      `No borrowable P0 bank found for destination mint: ${DESTINATION_MINT.toBase58()}. ` +
        `Only standard (DEFAULT/SOL) operational banks with a borrow limit support borrowing.`
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
  // Step 6: Build Swap Debt Transaction (direct, with bridged fallback)
  // --------------------------------------------------------------------------
  console.log("\n📝 Building swap debt transaction...");

  console.log(
    `   Swapping ${sourceUiAmount.toFixed(6)} ${sourceBank.tokenSymbol || "tokens"} debt`
  );
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

  // Market prices (USD per token, UI units) size the flashloan borrow. The debt-swap builder has
  // no ExactOut quote, so it estimates the borrow from these oracle prices. Pulled from the
  // client's realtime oracle prices (same source as 05-oracle-prices.ts). Bridge legs price
  // themselves from the same oracle map automatically.
  const repayMarketPrice = client.oraclePriceByBank
    .get(sourceBank.address.toBase58())
    ?.priceRealtime.price.toNumber();
  const borrowMarketPrice = client.oraclePriceByBank
    .get(destinationBank.address.toBase58())
    ?.priceRealtime.price.toNumber();
  if (repayMarketPrice === undefined || borrowMarketPrice === undefined) {
    throw new Error("Missing oracle price for the source or destination bank");
  }

  // ONE call builds the whole thing. The SDK tries the direct single-route swap first; if the
  // route won't fit the flashloan tx (size / account-locks) or can't be quoted, it transparently
  // decomposes into two debt swaps through a bridge token (repay source → borrow bridge, then
  // repay bridge → borrow destination) — one atomic Jito bundle — walking the bridge candidates in
  // priority order. `bridgeOpts` is optional (defaults to USDC → wSOL → USDT); we pass the
  // example's universal list to also try JitoSOL.
  const result = await wrappedAccount
    .makeBridgedSwapDebtTx({
      connection,
      repayOpts: {
        totalPositionAmount: sourceUiAmount,
        repayBank: sourceBank,
        tokenProgram: sourceMintData.tokenProgram,
        marketPrice: repayMarketPrice,
      },
      borrowOpts: {
        borrowBank: destinationBank,
        tokenProgram: destinationMintData.tokenProgram,
        marketPrice: borrowMarketPrice,
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
          `Swap must route through ${blocked}, but the account already supplies them. ` +
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

  // Quote display. For a debt swap the NEW debt is the borrow (`inAmount`) on the direct quote;
  // the merged bridged quote maps it to `outAmount` (new-debt-borrowed) — see mergeBridgeQuotesDebt.
  if (result.quoteResponse) {
    const newDebtNative = isBridged
      ? result.quoteResponse.outAmount
      : result.quoteResponse.inAmount;
    const newDebtUi = Number(newDebtNative) / Math.pow(10, destinationBank.mintDecimals);
    console.log(`\n📈 ${isBridged ? "Merged bridged" : "Swap-engine"} quote:`);
    console.log(
      `   New debt amount: ~${newDebtUi.toFixed(6)} ${destinationBank.tokenSymbol || "tokens"}`
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
          ? "SWAP DEBT"
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

swapDebtExample()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n❌ Error:", error);
    process.exit(1);
  });
