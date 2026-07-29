/**
 * Example: Loop (leverage) a position (SIMULATION MODE)
 *
 * A loop deposits collateral and borrows against it in ONE flash-loan transaction:
 * borrow X → swap X to the deposit asset → deposit — creating a leveraged position
 * without repeated deposit/borrow round-trips.
 *
 * This is the plain DIRECT loop (`makeLoopTx`): one flash-loan transaction with a single
 * borrow→deposit swap route. If that route doesn't fit one transaction (size / account-locks)
 * or can't be quoted, this build fails — see 16b-loop-bridged.ts for `makeBridgedLoopTx`,
 * which transparently falls back to a bridged double-hop in that case.
 *
 * This example shows how to:
 * 1. Initialize the Project0Client from config
 * 2. Fetch a marginfi account (the loop builds on an EXISTING account)
 * 3. Size a value-equivalent borrow from the desired leverage
 * 4. Build the loop with `makeLoopTx`
 * 5. Simulate the transaction bundle
 *
 * Setup:
 * 1. Copy .env.example to .env
 * 2. Fill in your configuration values
 * 3. Run: tsx 16a-loop.ts
 *
 * Env overrides:
 *   DEPOSIT_MINT    collateral to loop into (default: wSOL — the wallet must hold it)
 *   BORROW_MINT     debt to lever with (default: USDC)
 *   DEPOSIT_AMOUNT  principal deposited from the wallet, UI units (default: 0.01)
 *   LEVERAGE        target leverage, e.g. 2 = borrow one extra principal's worth (default: 2)
 *
 * Note: This runs in SIMULATION mode - no actual transactions are sent.
 */

import {
  Project0Client,
  MarginfiAccountWrapper,
  MarginfiAccount,
  simulateBundle,
  isStandardBorrowable,
  isStandardDepositable,
  isDecomposableSwapError,
} from "../src";
import { PublicKey } from "@solana/web3.js";
import {
  getConnection,
  getMarginfiConfig,
  getAccountAddress,
  getWalletPubkey,
  getSwapConfig,
  MINTS,
} from "./config";

// ============================================================================
// Configuration - Edit these to test different scenarios
// ============================================================================

// Collateral to loop into (the wallet must hold DEPOSIT_AMOUNT of it)
const DEPOSIT_MINT = process.env.DEPOSIT_MINT ? new PublicKey(process.env.DEPOSIT_MINT) : MINTS.SOL;

// Debt to lever with
const BORROW_MINT = process.env.BORROW_MINT ? new PublicKey(process.env.BORROW_MINT) : MINTS.USDC;

// Principal deposited from the wallet (UI units)
const DEPOSIT_AMOUNT = Number(process.env.DEPOSIT_AMOUNT ?? "0.01");

// Target leverage: total exposure / principal. 2x borrows one extra principal's worth.
const LEVERAGE = Number(process.env.LEVERAGE ?? "2");

// ============================================================================
// Main Example
// ============================================================================

async function loopExample() {
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
  // Step 4: Select Deposit and Borrow Banks
  // --------------------------------------------------------------------------
  console.log("\n🏦 Selecting banks...");

  // Deposit bank: only DEFAULT/SOL asset-tag, Operational banks accept deposits (excludes
  // ReduceOnly banks and Kamino/Drift/JupLend wrappers — depositing into those reverts).
  const depositBank = client.banks.find(
    (bank) => bank.mint.equals(DEPOSIT_MINT) && isStandardDepositable(bank)
  );
  if (!depositBank) {
    throw new Error(`No depositable bank found for deposit mint: ${DEPOSIT_MINT.toBase58()}`);
  }

  // Borrow bank: only standard banks with a borrow limit can be borrowed from.
  const borrowBank = client.banks.find(
    (bank) => bank.mint.equals(BORROW_MINT) && isStandardBorrowable(bank)
  );
  if (!borrowBank) {
    throw new Error(`No borrowable bank found for borrow mint: ${BORROW_MINT.toBase58()}`);
  }

  console.log(
    `✅ Deposit bank: ${depositBank.tokenSymbol ?? depositBank.mint.toBase58()} (${depositBank.address.toBase58()})`
  );
  console.log(
    `✅ Borrow bank: ${borrowBank.tokenSymbol ?? borrowBank.mint.toBase58()} (${borrowBank.address.toBase58()})`
  );

  // --------------------------------------------------------------------------
  // Step 5: Size the Borrow from the Target Leverage
  // --------------------------------------------------------------------------
  // Leverage L on principal P means borrowing (L - 1) × P worth of the borrow asset — the loop
  // swaps that borrow into more collateral. Sized here with oracle USD prices; the app seeds this
  // with Jupiter market prices instead (tradeable price) and falls back to the oracle.
  const priceOf = (bankAddress: PublicKey): number => {
    const price = client.oraclePriceByBank
      .get(bankAddress.toBase58())
      ?.priceRealtime.price.toNumber();
    if (!price || price <= 0) {
      throw new Error(`Missing oracle price for bank ${bankAddress.toBase58()}`);
    }
    return price;
  };
  const depositPrice = priceOf(depositBank.address);
  const borrowPrice = priceOf(borrowBank.address);

  const borrowAmount = (DEPOSIT_AMOUNT * (LEVERAGE - 1) * depositPrice) / borrowPrice;

  console.log(`\n📐 Loop sizing:`);
  console.log(
    `   Principal: ${DEPOSIT_AMOUNT} ${depositBank.tokenSymbol ?? "tokens"} (~$${(DEPOSIT_AMOUNT * depositPrice).toFixed(2)})`
  );
  console.log(`   Leverage: ${LEVERAGE}x`);
  console.log(
    `   Borrow: ~${borrowAmount.toFixed(6)} ${borrowBank.tokenSymbol ?? "tokens"} (~$${(borrowAmount * borrowPrice).toFixed(2)})`
  );

  // --------------------------------------------------------------------------
  // Step 6: Build the Loop Transaction
  // --------------------------------------------------------------------------
  console.log("\n📝 Building loop transaction...");

  const depositMintData = await wrappedAccount.getMintDataFromBank(depositBank);
  const borrowMintData = await wrappedAccount.getMintDataFromBank(borrowBank);

  // One flash-loan transaction: borrow X → swap X to the deposit asset → deposit. The swap engine
  // picks the best route (per getSwapConfig) that fits the remaining transaction budget.
  const result = await wrappedAccount
    .makeLoopTx({
      connection,
      depositOpts: {
        inputDepositAmount: DEPOSIT_AMOUNT,
        depositBank,
        tokenProgram: depositMintData.tokenProgram,
        loopMode: "DEPOSIT", // "BORROW" levers an existing position without new principal
        marketPrice: depositPrice,
      },
      borrowOpts: {
        borrowAmount,
        borrowBank,
        tokenProgram: borrowMintData.tokenProgram,
        marketPrice: borrowPrice,
      },
      swapOpts: { swapConfig: getSwapConfig() },
      assetShareValueMultiplierByBank: client.assetShareValueMultiplierByBank,
    })
    .catch((e) => {
      // A decomposable failure means the single-route swap didn't fit one transaction or had no
      // route — the pair itself may still be loopable through a bridge token. That fallback is
      // exactly what makeBridgedLoopTx adds; this plain example just points you there.
      if (isDecomposableSwapError(e)) {
        throw new Error(
          `Direct loop route didn't fit (${e.code}). ` +
            `Use makeBridgedLoopTx for the bridged double-hop fallback — see 16b-loop-bridged.ts.`
        );
      }
      throw e;
    });

  console.log(
    `✅ Loop built (${result.transactions.length} txs, action index ${result.actionTxIndex})`
  );

  // Quote display. The loop quote maps borrowed X (in) → extra collateral deposited (out).
  if (result.quoteResponse) {
    const borrowedUi =
      Number(result.quoteResponse.inAmount) / Math.pow(10, borrowBank.mintDecimals);
    const depositedUi =
      Number(result.quoteResponse.outAmount) / Math.pow(10, depositBank.mintDecimals);
    console.log(`\n📈 Swap-engine quote:`);
    console.log(`   Borrowed: ~${borrowedUi.toFixed(6)} ${borrowBank.tokenSymbol ?? "tokens"}`);
    console.log(
      `   Extra collateral: ~${depositedUi.toFixed(6)} ${depositBank.tokenSymbol ?? "tokens"}`
    );
    console.log(`   Price impact: ${result.quoteResponse.priceImpactPct ?? "N/A"}%`);
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
          ? "LOOP"
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
        "\n💡 To execute this loop, you would sign and send these transactions in order."
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

loopExample()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n❌ Error:", error);
    process.exit(1);
  });
