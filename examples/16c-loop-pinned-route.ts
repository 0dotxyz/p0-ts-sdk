/**
 * Example: Loop with a caller-controlled swap route (SIMULATION MODE)
 *
 * Integrators that must review/whitelist the exact swap they sign have two supported paths:
 *
 * (a) `swapEngineRunner` — RECOMMENDED. A function you supply that receives the swap request
 *     (mints, exact input amount, remaining tx budget) and returns the route to splice in,
 *     including the amount channel (`outputAmountNative`) that sizes the loop's deposit
 *     byte-patch. Wrap the SDK's real `runSwapEngine` to inspect/veto the route it selects,
 *     or build the route yourself entirely.
 *
 * (b) `swapOpts.swapIxs` — fully pinned. Pass exact, pre-reviewed instructions + lookup tables
 *     + the route's `quoteResponse`. The quote is REQUIRED: its `otherAmountThreshold`
 *     (guaranteed min-out, native units) sizes the deposit exactly like an engine-selected
 *     route, and its `inAmount` must equal the flow's swap input (the borrow) — the SDK
 *     validates both and throws otherwise. (Before 2.5.5-alpha.6 this path silently deposited
 *     zero collateral and failed init health at EndFlashloan.)
 *
 * This example demonstrates a realistic capture → review → pin workflow:
 *   1. Build the loop once with a capturing `swapEngineRunner` (path a) — the runner records the
 *      route the engine selected and lets us "review" it (here: log the programs it invokes).
 *   2. Build the loop again with that reviewed route pinned via `swapOpts.swapIxs` (path b).
 *   3. Simulate the pinned build — a green simulation proves the deposit was patched to the
 *      route's min-out (a zero-collateral deposit would fail init health at this leverage).
 *
 * Caller obligations when pinning: the route's input amount must equal the borrow, its output
 * must pay out to the flow's destination token account (the deposit ATA), and any extra ATAs the
 * route needs are yours to create. Note the bridged `makeBridged*Tx` fallbacks are disabled when
 * a pinned route is supplied — a pinned route belongs to the direct pair.
 *
 * Setup: same .env as the other examples. Run: tsx 16c-loop-pinned-route.ts
 */

import {
  Project0Client,
  MarginfiAccountWrapper,
  MarginfiAccount,
  simulateBundle,
  runSwapEngine,
  isStandardBorrowable,
  isStandardDepositable,
  type SwapQuoteResult,
} from "../src";
import { PublicKey, TransactionInstruction, AddressLookupTableAccount } from "@solana/web3.js";
import {
  getConnection,
  getMarginfiConfig,
  getAccountAddress,
  getSwapConfig,
  MINTS,
} from "./config";

const DEPOSIT_MINT = MINTS.SOL;
const BORROW_MINT = MINTS.USDC;
const DEPOSIT_AMOUNT = 0.01;
const LEVERAGE = 2;

async function main() {
  const connection = getConnection();
  const client = await Project0Client.initialize(connection, getMarginfiConfig());
  const account = await MarginfiAccount.fetch(getAccountAddress(), client.program);
  const wrappedAccount = new MarginfiAccountWrapper(account, client);
  console.log(`✅ Client + account ready (${client.banks.length} banks)`);

  const depositBank = client.banks.find(
    (b) => b.mint.equals(DEPOSIT_MINT) && isStandardDepositable(b)
  )!;
  const borrowBank = client.banks.find(
    (b) => b.mint.equals(BORROW_MINT) && isStandardBorrowable(b)
  )!;
  const priceOf = (bank: typeof depositBank) =>
    client.oraclePriceByBank.get(bank.address.toBase58())!.priceRealtime.price.toNumber();
  const depositPrice = priceOf(depositBank);
  const borrowPrice = priceOf(borrowBank);
  const borrowAmount = (DEPOSIT_AMOUNT * (LEVERAGE - 1) * depositPrice) / borrowPrice;

  const depositMintData = await wrappedAccount.getMintDataFromBank(depositBank);
  const borrowMintData = await wrappedAccount.getMintDataFromBank(borrowBank);
  const loopParams = {
    connection,
    depositOpts: {
      inputDepositAmount: DEPOSIT_AMOUNT,
      depositBank,
      tokenProgram: depositMintData.tokenProgram,
      loopMode: "DEPOSIT" as const,
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
  };

  // --------------------------------------------------------------------------
  // Path (a): capture + review the route via a custom swapEngineRunner
  // --------------------------------------------------------------------------
  console.log("\n📝 (a) Building with a capturing swapEngineRunner...");

  let captured: {
    instructions: TransactionInstruction[];
    lookupTables: AddressLookupTableAccount[];
    quoteResponse: SwapQuoteResult;
  } | null = null;

  const capturingRunner: typeof runSwapEngine = async (req) => {
    const result = await runSwapEngine(req);
    // ---- REVIEW POINT ----------------------------------------------------
    // The route is in hand before it's spliced into the flashloan. Inspect it,
    // check the programs it invokes against your allowlist, and veto by throwing.
    const programs = [...new Set(result.swapInstructions.map((ix) => ix.programId.toBase58()))];
    console.log(`   🔍 route via ${result.provider}, programs: ${programs.join(", ")}`);
    // ----------------------------------------------------------------------
    captured = {
      instructions: result.swapInstructions,
      lookupTables: result.swapLuts,
      quoteResponse: result.quoteResponse,
    };
    return result;
  };

  const viaRunner = await wrappedAccount.makeLoopTx({
    ...loopParams,
    swapEngineRunner: capturingRunner,
  });
  console.log(
    `✅ Runner build: ${viaRunner.transactions.length} txs, min-out ${viaRunner.quoteResponse?.otherAmountThreshold} native`
  );
  if (!captured) throw new Error("runner was never invoked");

  // --------------------------------------------------------------------------
  // Path (b): pin the reviewed route via swapOpts.swapIxs
  // --------------------------------------------------------------------------
  console.log("\n📝 (b) Rebuilding with the reviewed route PINNED via swapOpts.swapIxs...");

  const pinned = await wrappedAccount.makeLoopTx({
    ...loopParams,
    swapOpts: {
      // No swapConfig needed — the engine never runs; the pinned route is spliced verbatim and
      // its quote's min-out sizes the deposit byte-patch.
      swapIxs: captured,
    },
  });
  console.log(
    `✅ Pinned build: ${pinned.transactions.length} txs, deposit sized from min-out ` +
      `${pinned.quoteResponse?.otherAmountThreshold} native (+ principal)`
  );

  // --------------------------------------------------------------------------
  // Simulate the pinned build. Green = the deposit really was patched to min-out:
  // at 2x leverage a zero-collateral deposit would fail init health at EndFlashloan.
  // --------------------------------------------------------------------------
  console.log("\n🔄 Simulating the pinned build...");
  const sims = await simulateBundle(connection.rpcEndpoint, pinned.transactions);
  sims.forEach((r, i) =>
    console.log(
      `   tx ${i + 1}/${sims.length}: ${r.err ? "❌ " + JSON.stringify(r.err) : `✅ (${r.unitsConsumed} CU)`}`
    )
  );
  if (sims.some((r) => r.err)) {
    sims.flatMap((r) => r.logs?.slice(-5) ?? []).forEach((l) => console.log("     " + l));
    throw new Error("pinned build failed simulation");
  }
  console.log(
    "\n✅ Pinned-route loop simulated successfully — deposit patched from the pinned quote!"
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("❌", e);
    process.exit(1);
  });
