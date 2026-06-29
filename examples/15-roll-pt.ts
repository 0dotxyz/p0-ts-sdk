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

import { PublicKey } from "@solana/web3.js";

import { Project0Client, MarginfiAccountWrapper, MarginfiAccount } from "../src";
import { getConnection, getMarginfiConfig, getAccountAddress } from "./config";

// ---- The bulkSOL roll (matured PT-bulkSOL → active PT-bulkSOL). Override via env. -------
const MATURED_MARKET = new PublicKey(process.env.MATURED_PT_MARKET ?? "scSc4o3AkRoW6uooY3M54GUstZnYb4fADieeWz8AYco");
const MATURED_PT_BANK = new PublicKey(process.env.MATURED_PT_BANK ?? "9ThXmfwhNzc6qbkRLuSGHwKS7mxjn6QcuRD644Pjn4F");
const PT_NEW = new PublicKey(process.env.SUCCESSOR_PT_MINT ?? "HgyWqTZ6JdGYF5TfrYmScTyvsyuopwYRJXwqA2LzCrz6");
// The successor maturity's CLMM (MarketThree) PT/SY pool — where the new PT trades.
const SUCCESSOR_MARKET = new PublicKey(process.env.SUCCESSOR_PT_MARKET ?? "7NSpRqs1ZNiZharyTwKyprfanQsaPprZSm1z84nVsbKn");
const SLIPPAGE_BPS = Number(process.env.SLIPPAGE_BPS ?? 100);

async function main() {
  const connection = getConnection();
  const client = await Project0Client.initialize(connection, getMarginfiConfig());
  const account = await MarginfiAccount.fetch(getAccountAddress(), client.program);
  const wrapper = new MarginfiAccountWrapper(account, client);

  const maturedBank = client.bankMap.get(MATURED_PT_BANK.toBase58())!;
  const successorBank = [...client.bankMap.values()].find((b) => b.mint.equals(PT_NEW))!;
  const maturedMint = await wrapper.getMintDataFromBank(maturedBank);
  const successorMint = await wrapper.getMintDataFromBank(successorBank);

  const positionUi = account.balances
    .find((b) => b.bankPk.equals(MATURED_PT_BANK))!
    .computeQuantityUi(maturedBank).assets.toNumber();
  const withdrawUi = Number(process.env.ROLL_PT ?? String(positionUi)); // default: full roll
  console.log(`rolling ${withdrawUi} matured PT → new PT (merge → CLMM trade_pt → deposit)`);

  const { transactions, actionTxIndex, quoteResponse } = await wrapper.makeRollPtTx({
    connection,
    assetShareValueMultiplierByBank: new Map(),
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
      ...(process.env.PT_ROLL_LUT ? { lookupTable: new PublicKey(process.env.PT_ROLL_LUT) } : {}),
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

  // Simulate the whole bundle (setup + crank + flashloan), chained state.
  const bh = (await connection.getLatestBlockhash("confirmed")).blockhash;
  const encoded = transactions.map((tx) => {
    tx.message.recentBlockhash = bh;
    return Buffer.from(tx.serialize()).toString("base64");
  });
  const nulls = encoded.map(() => null);
  const res = await fetch(connection.rpcEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "simulateBundle",
      params: [
        { encodedTransactions: encoded },
        { preExecutionAccountsConfigs: nulls, postExecutionAccountsConfigs: nulls, skipSigVerify: true },
      ],
    }),
  }).then((r) => r.json());
  if (res.error) return console.log("bundle err:", JSON.stringify(res.error));
  const results = res.result?.value?.transactionResults ?? res.result?.transactionResults ?? [];
  results.forEach((t: any, i: number) => {
    console.log(`  tx[${i}] err: ${JSON.stringify(t.err ?? null)}`);
    if (t.err) (t.logs ?? []).slice(-14).forEach((l: string) => console.log(`     ${l}`));
  });
  console.log(
    results.length && results.every((t: any) => !t.err)
      ? "\n✅ full deposit rolled into new PT — no YT byproduct"
      : "\n❌ simulation failed"
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
