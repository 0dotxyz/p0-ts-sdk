/**
 * Manual smoke example for the multi-provider swap engine.
 *
 * Builds a real `SwapEngineRequest` for a token pair and runs `runSwapEngine`,
 * which fans out to Titan (V3 + transactionTemplate) and Jupiter (Router /build
 * at a maxAccounts ladder) in parallel and picks the best fitting route. The
 * engine logs the candidate comparison (`[swap-engine] selected {...}`) so you
 * can watch which provider wins.
 *
 * Run (after `pnpm build`):
 *   RPC_ENDPOINT=https://... \
 *   TITAN_GATEWAY_URL=https://<host>/api/v1 TITAN_API_KEY=... \
 *   JUPITER_API_KEY=... \
 *   npx tsx examples/swap-engine.ts
 *
 * Optional overrides: INPUT_MINT, OUTPUT_MINT, AMOUNT (native), TAKER (pubkey).
 * Only the providers you supply credentials for are queried.
 */
import { ComputeBudgetProgram, Connection, PublicKey } from "@solana/web3.js";

import {
  runSwapEngine,
  SwapProvider,
  type SwapEngineRequest,
  type SwapProviderEntry,
} from "../dist/index.js";
import { getAssociatedTokenAddressSync } from "../dist/vendor.js";

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const WSOL = "So11111111111111111111111111111111111111112";

async function main() {
  const rpc =
    process.env.RPC_ENDPOINT ||
    process.env.PRIVATE_RPC_ENDPOINT ||
    process.env.NEXT_PUBLIC_RPC_ENDPOINT;
  if (!rpc) throw new Error("Set RPC_ENDPOINT (or PRIVATE_RPC_ENDPOINT)");

  const inputMint = process.env.INPUT_MINT || USDC;
  const outputMint = process.env.OUTPUT_MINT || WSOL;
  const amountNative = Number(process.env.AMOUNT || 100_000_000); // 100 USDC
  const taker = new PublicKey(
    process.env.TAKER || "Affd7LDkUY9fjWjjQSr9bvises1Cku4WSwdLNGBhgVW3"
  );

  const connection = new Connection(rpc, "confirmed");
  const destinationTokenAccount = getAssociatedTokenAddressSync(
    new PublicKey(outputMint),
    taker,
    true
  );

  // Only query providers we have credentials for.
  const providers: SwapProviderEntry[] = [];
  if (process.env.TITAN_GATEWAY_URL) {
    providers.push({
      provider: SwapProvider.TITAN,
      apiConfig: { basePath: process.env.TITAN_GATEWAY_URL, apiKey: process.env.TITAN_API_KEY },
    });
  }
  if (process.env.JUPITER_API_KEY) {
    providers.push({
      provider: SwapProvider.JUPITER,
      apiConfig: { basePath: "https://api.jup.ag/swap/v1", apiKey: process.env.JUPITER_API_KEY },
    });
  }
  if (providers.length === 0) {
    throw new Error("Set TITAN_GATEWAY_URL and/or JUPITER_API_KEY to query a provider");
  }

  // Stand in for the rest of the flashloan tx. A couple of compute-budget ixs +
  // a generous budget is enough to exercise route selection.
  const footprintIxs = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: 1_200_000 }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1 }),
  ];

  const req: SwapEngineRequest = {
    inputMint,
    outputMint,
    amountNative,
    inputDecimals: 6,
    outputDecimals: 9,
    slippageBps: 50,
    slippageMode: "DYNAMIC",
    platformFeeBps: 0,
    taker,
    destinationTokenAccount,
    connection,
    footprint: {
      instructions: footprintIxs,
      luts: [],
      payer: taker,
      sizeConstraint: 900,
      maxSwapTotalAccounts: 40,
    },
    providers,
  };

  console.log(
    `Querying ${providers.map((p) => p.provider).join(" + ")} for ${amountNative} ${inputMint} -> ${outputMint}\n`
  );

  const result = await runSwapEngine(req);

  console.log("\n=== WINNER ===");
  console.log("provider:          ", result.provider);
  console.log("expected out:      ", result.quoteResponse.outAmount);
  console.log("min out (patched): ", result.outputAmountNative.toString());
  console.log("swap ixs:          ", result.swapInstructions.length);
  console.log("setup ixs:         ", result.setupInstructions.length);
  console.log("luts:              ", result.swapLuts.length);
}

main().catch((err) => {
  console.error("\nexample failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
