/**
 * Example: Roll a matured Exponent PT collateral position into its next maturity, so the
 * user's **full deposit ends up as new PT** — in one flash-loan-wrapped bundle:
 *
 *     withdraw PT_old → merge (PT_old → SY) → CLMM trade_pt (SY → PT_new) → deposit PT_new
 *
 * The matured PT is redeemed 1:1 to its SY, then the successor PT is bought **directly on its
 * CLMM (`MarketThree`) PT/SY pool** — no base-token round-trip and no external aggregator (the
 * newer maturities only list a CLMM pool; the SY mint is shared across maturities, so the
 * redeemed SY feeds the buy directly). The SY → PT price is quoted by simulating the redeem +
 * trade, so no Titan/Jupiter credentials are needed. You pass the matured Exponent market/vault
 * + the successor CLMM pool (`rollOpts`); everything Exponent is resolved internally.
 *
 *   SOLANA_RPC_URL=https://...  (examples/.env)
 *   MARGINFI_ACCOUNT_ADDRESS=<account holding matured PT collateral>
 * Then: tsx 15-roll-pt.ts   (SIMULATION only — nothing is sent.)
 */

import { address, compileTransaction } from "@solana/kit";

import { Project0Client, MarginfiAccountWrapper, MarginfiAccount, simulateBundle } from "../src";
import { getRpc, getMarginfiConfig, getAccountAddress } from "./config";

// ---- The bulkSOL roll (matured PT-bulkSOL → active PT-bulkSOL). Override via env. -------
const MATURED_MARKET = address(process.env.MATURED_PT_MARKET ?? "scSc4o3AkRoW6uooY3M54GUstZnYb4fADieeWz8AYco");
const MATURED_PT_BANK = address(process.env.MATURED_PT_BANK ?? "9ThXmfwhNzc6qbkRLuSGHwKS7mxjn6QcuRD644Pjn4F");
const PT_NEW = address(process.env.SUCCESSOR_PT_MINT ?? "HgyWqTZ6JdGYF5TfrYmScTyvsyuopwYRJXwqA2LzCrz6");
// The successor maturity's CLMM (MarketThree) PT/SY pool — where the new PT trades.
const SUCCESSOR_MARKET = address(process.env.SUCCESSOR_PT_MARKET ?? "7NSpRqs1ZNiZharyTwKyprfanQsaPprZSm1z84nVsbKn");
const SLIPPAGE_BPS = Number(process.env.SLIPPAGE_BPS ?? 100);

async function main() {
  const { rpc, rpcEndpoint } = getRpc();
  const client = await Project0Client.initialize({ rpc, rpcEndpoint }, getMarginfiConfig());
  const account = await MarginfiAccount.fetch(getAccountAddress(), rpc);
  const wrapper = new MarginfiAccountWrapper(account, client);

  const maturedBank = client.getBank(MATURED_PT_BANK)!;
  const successorBank = client.getBanksByMint(PT_NEW)[0]!;
  const maturedMint = await wrapper.getMintDataFromBank(maturedBank);
  const successorMint = await wrapper.getMintDataFromBank(successorBank);

  const positionUi = account
    .getBalance(MATURED_PT_BANK)
    .computeQuantityUi(maturedBank)
    .assets.toNumber();
  const withdrawUi = Number(process.env.ROLL_PT ?? String(positionUi)); // default: full roll
  console.log(`rolling ${withdrawUi} matured PT → new PT (merge → CLMM trade_pt → deposit)`);

  const { transactions, actionTxIndex, quoteResponse } = await wrapper.makeRollPtTx({
    withdrawOpts: {
      totalPositionAmount: positionUi,
      withdrawAmount: withdrawUi,
      withdrawBank: maturedBank,
      tokenProgram: maturedMint.tokenProgram,
    },
    depositOpts: { depositBank: successorBank, tokenProgram: successorMint.tokenProgram },
    // The whole Exponent redeem + buy is internal: pass the matured market + the successor CLMM
    // pool. A dedicated PT-roll LUT (see create-pt-roll-lut.ts) can compress the flashloan bytes.
    rollOpts: {
      maturedMarket: MATURED_MARKET,
      successorMarket: SUCCESSOR_MARKET,
      slippageBps: SLIPPAGE_BPS,
      ...(process.env.PT_ROLL_LUT ? { lookupTable: address(process.env.PT_ROLL_LUT) } : {}),
    },
  });

  console.log(`built ${transactions.length} tx(s), action tx index ${actionTxIndex}`);
  if (quoteResponse) {
    console.log(
      `  SY in (native): ${quoteResponse.inAmount}  → PT_new out (native): ${quoteResponse.outAmount}` +
        `  (min ${quoteResponse.otherAmountThreshold} @ ${quoteResponse.slippageBps}bps)`
    );
  }
  if (process.env.NO_SIM) return; // build-only (skip the slow chained bundle sim)

  // Simulate the whole bundle (setup + flashloan), chained state.
  const results = await simulateBundle(
    rpcEndpoint,
    transactions.map((tx) => compileTransaction(tx.message))
  );
  results.forEach((t, i) => {
    console.log(`  tx[${i}] err: ${JSON.stringify(t.err ?? null)}`);
    if (t.err) (t.logs ?? []).slice(-14).forEach((l) => console.log(`     ${l}`));
  });
  console.log(
    results.every((t) => !t.err)
      ? "\n✅ full deposit rolled into new PT — no YT byproduct"
      : "\n❌ simulation failed"
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
