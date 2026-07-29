/**
 * Example: Loop (leverage) a position with the bridged double-hop fallback (SIMULATION MODE)
 *
 * A loop deposits collateral and borrows against it in ONE flash-loan transaction:
 * borrow X → swap X to the deposit asset → deposit — creating a leveraged position
 * without repeated deposit/borrow round-trips. See 16a-loop.ts for the plain direct loop;
 * this variant is the ONE-call production shape that also handles pairs the direct route
 * can't serve.
 *
 * This example shows how to:
 * 1. Initialize the Project0Client from config
 * 2. Fetch a marginfi account (the loop builds on an EXISTING account)
 * 3. Size a value-equivalent borrow from the desired leverage
 * 4. Build the loop in ONE call with `makeBridgedLoopTx` — it tries the direct loop first and
 *    transparently falls back to a bridged DOUBLE-HOP (loop borrowing a bridge token, then
 *    debt-swap the bridge debt to the requested borrow asset) as one atomic Jito bundle when
 *    the direct borrow→deposit swap doesn't fit one transaction or can't be quoted
 * 5. Simulate the transaction bundle
 *
 * Setup:
 * 1. Copy .env.example to .env
 * 2. Fill in your configuration values
 * 3. Run: tsx 16b-loop-bridged.ts
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

  console.log(`✅ Deposit bank: ${depositBank.tokenSymbol} (${depositBank.address.toBase58()})`);
  console.log(`✅ Borrow bank: ${borrowBank.tokenSymbol} (${borrowBank.address.toBase58()})`);

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
    `   Principal: ${DEPOSIT_AMOUNT} ${depositBank.tokenSymbol} (~$${(DEPOSIT_AMOUNT * depositPrice).toFixed(2)})`
  );
  console.log(`   Leverage: ${LEVERAGE}x`);
  console.log(
    `   Borrow: ~${borrowAmount.toFixed(6)} ${borrowBank.tokenSymbol} (~$${(borrowAmount * borrowPrice).toFixed(2)})`
  );

  // --------------------------------------------------------------------------
  // Step 6: Build the Loop Transaction (direct, with bridged fallback)
  // --------------------------------------------------------------------------
  console.log("\n📝 Building loop transaction...");

  const depositMintData = await wrappedAccount.getMintDataFromBank(depositBank);
  const borrowMintData = await wrappedAccount.getMintDataFromBank(borrowBank);

  // ONE call builds the whole thing. The SDK tries the direct loop first (borrow X → swap →
  // deposit, flash-loan wrapped); if the borrow→deposit swap won't fit the flashloan tx or can't
  // be quoted, it transparently loops against a value-equivalent borrow of a bridge token and
  // debt-swaps that bridge debt to X — one atomic Jito bundle. `bridgeOpts` is optional (defaults
  // to USDC → wSOL → USDT); we pass the example's universal list to also try JitoSOL.
  const result = await wrappedAccount
    .makeBridgedLoopTx({
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
      bridgeOpts: { bridgeCandidateMints: UNIVERSAL_BRIDGE_MINTS },
    })
    .catch((e) => {
      // BRIDGE_CONFLICT means the direct loop failed AND every bridge candidate is blocked by an
      // opposite-side position (a token can't be both collateral and debt on one bank). Any other
      // error is the direct build's failure (health, size with no bridge fitting, etc.).
      if (isBridgeConflictError(e)) {
        const blocked = e.details.conflictingBanks.map((b) => b.symbol ?? b.mint).join(", ");
        throw new Error(
          `Loop must route through ${blocked}, but the account already supplies them. ` +
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
      `✅ Direct loop built (${result.transactions.length} txs, action index ${result.actionTxIndex})`
    );
  }

  // Quote display. The loop quote maps borrowed X (in) → extra collateral deposited (out), for
  // both the direct quote and the merged bridged quote (see mergeBridgeQuotesLoop).
  if (result.quoteResponse) {
    const borrowedUi =
      Number(result.quoteResponse.inAmount) / Math.pow(10, borrowBank.mintDecimals);
    const depositedUi =
      Number(result.quoteResponse.outAmount) / Math.pow(10, depositBank.mintDecimals);
    console.log(`\n📈 ${isBridged ? "Merged bridged" : "Swap-engine"} quote:`);
    console.log(`   Borrowed: ~${borrowedUi.toFixed(6)} ${borrowBank.tokenSymbol}`);
    console.log(`   Extra collateral: ~${depositedUi.toFixed(6)} ${depositBank.tokenSymbol}`);
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
      const txType = isBridged
        ? `BUNDLE ${index + 1}/${simulationResults.length}`
        : index === result.actionTxIndex
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
        "\n💡 To execute this loop, you would sign and send these transactions in order" +
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

loopExample()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n❌ Error:", error);
    process.exit(1);
  });
