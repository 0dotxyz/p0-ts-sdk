/**
 * TEMPORARY TEST HARNESS — forces makeBridgedLoopTx's bridged fallback (SIMULATION MODE).
 *
 * Small/healthy test accounts leave so much transaction budget that modern aggregators can route
 * ANY direct pair, so the fallback never fires naturally here (in production it fires on heavy
 * accounts whose footprint shrinks the swap budget). This harness uses the public
 * `swapEngineRunner` seam to make ONLY the direct pair (STAR → wSOL) fail with a real
 * SWAP_QUOTE_FAILED, exactly as if it were unroutable/oversized. Everything else — fallback
 * classification, candidate selection, both legs' real quotes, atomic-bundle composition, and
 * bundle simulation — runs the real code against mainnet.
 */

import {
  Project0Client,
  MarginfiAccountWrapper,
  MarginfiAccount,
  simulateBundle,
  runSwapEngine,
  TransactionBuildingError,
  isStandardBorrowable,
  isStandardDepositable,
} from "../src";
import { PublicKey } from "@solana/web3.js";
import {
  getConnection,
  getMarginfiConfig,
  getAccountAddress,
  getSwapConfig,
  MINTS,
  UNIVERSAL_BRIDGE_MINTS,
} from "./config";

const DEPOSIT_MINT = MINTS.SOL;
const BORROW_MINT = new PublicKey("star9agSpjiFe3M49B3RniVU4CMBBEK3Qnaqn3RGiFM"); // STAR
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
  console.log(`📐 borrow ~${borrowAmount.toFixed(4)} STAR (~$${(borrowAmount * borrowPrice).toFixed(2)})`);

  // Wrap the real engine; refuse ONLY the direct pair (STAR -> wSOL). The bridge legs
  // (USDC -> wSOL and STAR -> USDC) pass through to the real multi-provider engine.
  const forcedRunner: typeof runSwapEngine = async (req) => {
    if (req.inputMint === BORROW_MINT.toBase58() && req.outputMint === DEPOSIT_MINT.toBase58()) {
      console.log("⛔ [forced] refusing direct pair STAR → wSOL (simulating no-route/oversize)");
      throw TransactionBuildingError.swapQuoteFailed(
        "JUPITER",
        req.inputMint,
        req.outputMint,
        "forced by test harness: direct pair unroutable"
      );
    }
    return runSwapEngine(req);
  };

  const depositMintData = await wrappedAccount.getMintDataFromBank(depositBank);
  const borrowMintData = await wrappedAccount.getMintDataFromBank(borrowBank);

  const result = await wrappedAccount.makeBridgedLoopTx({
    connection,
    depositOpts: {
      inputDepositAmount: DEPOSIT_AMOUNT,
      depositBank,
      tokenProgram: depositMintData.tokenProgram,
      loopMode: "DEPOSIT",
      marketPrice: depositPrice,
    },
    borrowOpts: {
      borrowAmount,
      borrowBank,
      tokenProgram: borrowMintData.tokenProgram,
      marketPrice: borrowPrice,
    },
    swapOpts: { swapConfig: getSwapConfig() },
    swapEngineRunner: forcedRunner,
    bridgeOpts: { bridgeCandidateMints: UNIVERSAL_BRIDGE_MINTS },
  });

  const bridgeBank = result.bridgeMint
    ? client.banks.find((b) => b.mint.equals(result.bridgeMint!))
    : undefined;
  console.log(
    result.bridgeMint
      ? `✅ BRIDGED bundle built via ${bridgeBank?.tokenSymbol ?? result.bridgeMint.toBase58()} (${result.transactions.length} txs)`
      : `⚠️ unexpectedly built the DIRECT path (${result.transactions.length} txs)`
  );
  if (result.quoteResponse) {
    console.log(
      `📈 merged quote: borrow ${result.quoteResponse.inAmount} (native STAR) → deposit ${result.quoteResponse.outAmount} (native wSOL)`
    );
  }

  console.log("\n🔄 Simulating atomic bundle...");
  const sims = await simulateBundle(connection.rpcEndpoint, result.transactions);
  sims.forEach((r, i) => {
    console.log(
      `   tx ${i + 1}/${sims.length}: ${r.err ? "❌ " + JSON.stringify(r.err) : `✅ (${r.unitsConsumed} CU)`}`
    );
    if (r.err && r.logs) r.logs.slice(-5).forEach((l) => console.log("     " + l));
  });
  const ok = sims.every((r) => !r.err);
  console.log(ok ? "\n✅ Bridged double-hop bundle simulated successfully!" : "\n⚠️ Simulation failures above.");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("❌", e);
    process.exit(1);
  });
