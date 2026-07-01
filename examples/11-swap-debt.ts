/**
 * Example: Swap debt from one type to another (SIMULATION MODE)
 *
 * This example shows how to:
 * 1. Initialize the Project0Client from config
 * 2. Fetch a marginfi account
 * 3. Find an existing debt position
 * 4. Build a swap debt transaction (source debt -> destination debt)
 * 5. Simulate the transaction bundle
 *
 * The swap is executed via flash loan, so account health is not affected during the swap.
 * Flow: Borrow new debt -> Jupiter swap -> Repay old debt
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
  makeSwapDebtTx,
  composeBridgedSwap,
  mergeBridgeQuotesDebt,
  resolveBridgeBanks,
  isStandardBorrowable,
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
  // Step 6: Build Swap Debt Transaction
  // --------------------------------------------------------------------------
  console.log("\n📝 Building swap debt transaction...");

  console.log(
    `   Swapping ${sourceUiAmount.toFixed(6)} ${sourceBank.tokenSymbol || "tokens"} debt`
  );
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

  // Market prices (USD per token, UI units) size the flashloan borrow. The debt-swap builder has
  // no ExactOut quote, so it estimates the borrow from these oracle prices. Pulled from the
  // client's realtime oracle prices (same source as 05-oracle-prices.ts).
  const repayMarketPrice = client.oraclePriceByBank
    .get(sourceBank.address.toBase58())
    ?.priceRealtime.price.toNumber();
  const borrowMarketPrice = client.oraclePriceByBank
    .get(destinationBank.address.toBase58())
    ?.priceRealtime.price.toNumber();
  if (repayMarketPrice === undefined || borrowMarketPrice === undefined) {
    throw new Error("Missing oracle price for the source or destination bank");
  }

  // Multi-provider swap-engine config (TITAN primary + JUPITER fallback), exactly like the app.
  const swapOpts = { swapConfig: getSwapConfig() };

  // Build the swap. Try the direct single-route build first; if the route won't fit the flashloan
  // tx (size) or can't be quoted, fall back to a bridged DOUBLE-HOP (repay A → borrow bridge, then
  // repay bridge → borrow C) submitted as one atomic Jito bundle — the same fallback the app does.
  let transactions;
  let displayQuote; // single-route quote, or the merged quote across the two bridged legs
  let actionTxIndex: number | undefined;
  let isBridged = false;

  try {
    const direct = await wrappedAccount.makeSwapDebtTx({
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
      assetShareValueMultiplierByBank: client.assetShareValueMultiplierByBank,
      swapOpts,
    });
    transactions = direct.transactions;
    actionTxIndex = direct.actionTxIndex;
    displayQuote = direct.quoteResponse;
    console.log(`✅ Direct swap built (${transactions.length} txs, action index ${actionTxIndex})`);
  } catch (e) {
    // Only a too-big (size) or unquotable route is decomposable into a bridge hop. Anything else
    // (insufficient health, etc.) is a real failure — rethrow.
    if (!isDecomposableSwapError(e)) throw e;
    console.log(`\n⚠️  Direct route didn't fit (${e.code}). Trying a bridged double-hop...`);

    const bridged = await buildBridgedDebtSwap({
      client,
      wrappedAccount,
      account,
      connection,
      feePayer: walletPubkey,
      sourceBank,
      sourceUiAmount,
      sourceTokenProgram: sourceMintData.tokenProgram,
      repayMarketPrice,
      destinationBank,
      destinationTokenProgram: destinationMintData.tokenProgram,
      borrowMarketPrice,
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

  // Quote display. For a debt swap the NEW debt is the borrow (`inAmount`) on the direct quote;
  // the merged bridged quote maps it to `outAmount` (new-debt-borrowed) — see mergeBridgeQuotesDebt.
  if (displayQuote) {
    const newDebtNative = isBridged ? displayQuote.outAmount : displayQuote.inAmount;
    const newDebtUi = Number(newDebtNative) / Math.pow(10, destinationBank.mintDecimals);
    console.log(`\n📈 ${isBridged ? "Merged bridged" : "Swap-engine"} quote:`);
    console.log(
      `   New debt amount: ~${newDebtUi.toFixed(6)} ${destinationBank.tokenSymbol || "tokens"}`
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
          ? "SWAP DEBT"
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
// Bridge double-hop fallback (mirrors the app's tryBridgeDebtSwap)
// ============================================================================

/**
 * Decompose a `source → destination` DEBT swap into two debt swaps through a high-liquidity bridge
 * token: leg 1 repays the source debt and borrows the bridge (A → B), leg 2 repays the bridge debt
 * and borrows the destination (B → C). Both are composed into one atomic bundle by the SDK's
 * `composeBridgedSwap`. Returns the bundle + a merged user-facing quote, or null if no bridge fit.
 *
 * Bridge SELECTION is product policy (app-owned in production). Here we hand the universal bridge
 * mints to the SDK's `resolveBridgeBanks` with `side: "borrow"` — leg 1 BORROWS the bridge, so the
 * bank must be standard-borrowable, and we skip any bridge the account already holds as an ASSET
 * (marginfi forbids asset+liability on one bank).
 */
async function buildBridgedDebtSwap(args: {
  client: Project0Client;
  wrappedAccount: MarginfiAccountWrapper;
  account: MarginfiAccount;
  connection: Connection;
  feePayer: PublicKey;
  sourceBank: Bank;
  sourceUiAmount: number;
  sourceTokenProgram: PublicKey;
  repayMarketPrice: number;
  destinationBank: Bank;
  destinationTokenProgram: PublicKey;
  borrowMarketPrice: number;
}) {
  const { client, wrappedAccount, account, connection, feePayer } = args;
  const { sourceBank, sourceUiAmount, sourceTokenProgram, repayMarketPrice } = args;
  const { destinationBank, destinationTokenProgram, borrowMarketPrice } = args;

  const swapOpts = { swapConfig: getSwapConfig() };

  // Universal bridge mints (high liquidity); never bridge through the source/destination itself.
  const orderedBridgeMints = UNIVERSAL_BRIDGE_MINTS.filter(
    (m) => !m.equals(sourceBank.mint) && !m.equals(destinationBank.mint)
  );

  // Let the SDK resolve mints → standard-borrowable banks and drop opposite-side (asset) conflicts.
  const { bridges } = resolveBridgeBanks({
    orderedBridgeMints,
    banks: client.banks,
    marginfiAccount: account,
    side: "borrow",
  });

  for (const bridgeBank of bridges) {
    const bridgePrice = client.oraclePriceByBank
      .get(bridgeBank.address.toBase58())
      ?.priceRealtime.price.toNumber();
    if (bridgePrice === undefined) continue; // need a market price to size both legs

    const bridgeMintData = await wrappedAccount.getMintDataFromBank(bridgeBank);

    // Leg 1: repay source (A) → borrow bridge (B), built against the real account.
    const leg1 = await wrappedAccount.makeSwapDebtTx({
      connection,
      repayOpts: {
        totalPositionAmount: sourceUiAmount,
        repayBank: sourceBank,
        tokenProgram: sourceTokenProgram,
        marketPrice: repayMarketPrice,
      },
      borrowOpts: {
        borrowBank: bridgeBank,
        tokenProgram: bridgeMintData.tokenProgram,
        marketPrice: bridgePrice,
      },
      assetShareValueMultiplierByBank: client.assetShareValueMultiplierByBank,
      swapOpts,
    });
    if (!leg1.quoteResponse) continue; // need a quote to size leg 2

    const firstLeg: BridgedSwapLeg = {
      transactions: leg1.transactions,
      quoteResponse: leg1.quoteResponse,
    };

    // Size leg 2 from the EXACT bridge debt leg 1 creates. For a debt swap the engine is ExactIn on
    // the borrow, so `inAmount` is precisely the amount of bridge borrowed — i.e. the new B debt.
    const bridgeDebtUiAmount =
      Number(leg1.quoteResponse.inAmount) / Math.pow(10, bridgeBank.mintDecimals);

    // Leg 2: repay bridge (B) → borrow destination (C), built against the account AFTER leg 1.
    // composeBridgedSwap replays leg 1's effect onto a clone and passes us that projected account.
    const buildSecondLeg = async (
      projectedAccount: MarginfiAccountType
    ): Promise<BridgedSwapLeg> => {
      const leg2 = await makeSwapDebtTx({
        program: client.program,
        marginfiAccount: projectedAccount,
        connection,
        bankMap: client.bankMap,
        oraclePrices: client.oraclePriceByBank,
        assetShareValueMultiplierByBank: client.assetShareValueMultiplierByBank,
        bankMetadataMap: client.bankIntegrationMap,
        repayOpts: {
          totalPositionAmount: bridgeDebtUiAmount,
          repayBank: bridgeBank,
          tokenProgram: bridgeMintData.tokenProgram,
          marketPrice: bridgePrice,
        },
        borrowOpts: {
          borrowBank: destinationBank,
          tokenProgram: destinationTokenProgram,
          marketPrice: borrowMarketPrice,
        },
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
      mergedQuote: mergeBridgeQuotesDebt(composed.firstLegQuote, composed.secondLegQuote),
    };
  }

  return null;
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
