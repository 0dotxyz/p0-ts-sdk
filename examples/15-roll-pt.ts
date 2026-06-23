/**
 * Example: Roll a matured Exponent PT collateral position into its next maturity, so the
 * user's **full deposit ends up as new PT** — in one flash-loan-wrapped bundle:
 *
 *     withdraw PT_old → wrapper_merge (PT_old → underlying base, e.g. bulkSOL)
 *       → swap-engine (base → PT_new, Titan) → deposit PT_new
 *
 * `makeRollPtTx` is structurally `makeSwapCollateralTx` with a `wrapper_merge` leg in front:
 * the matured PT is redeemed to a normal, swappable base token (never the un-swappable SY),
 * then the same multi-provider swap engine buys the new PT. You pass the matured Exponent
 * market/vault + the base token (`rollOpts`) and the swap config (`swapOpts`); everything
 * Exponent is resolved internally.
 *
 * Routing base → PT_new needs an Exponent-aware aggregator, so set Titan creds:
 *   SOLANA_RPC_URL=https://...  (examples/.env)
 *   TITAN_GATEWAY_URL=https://<host>/api/v1  TITAN_API_KEY=...
 *   MARGINFI_ACCOUNT_ADDRESS=<account holding matured PT collateral>
 * Then: tsx 15-roll-pt.ts   (SIMULATION only — nothing is sent.)
 */

import { PublicKey } from "@solana/web3.js";

import { Project0Client, MarginfiAccountWrapper, MarginfiAccount } from "../src";
import { SwapProvider } from "../src/services/account/types";
import { getConnection, getMarginfiConfig, getAccountAddress } from "./config";

// ---- The bulkSOL roll (matured PT-bulkSOL → active PT-bulkSOL). Override via env. -------
const MATURED_MARKET = new PublicKey(process.env.MATURED_PT_MARKET ?? "scSc4o3AkRoW6uooY3M54GUstZnYb4fADieeWz8AYco");
const MATURED_PT_BANK = new PublicKey(process.env.MATURED_PT_BANK ?? "9ThXmfwhNzc6qbkRLuSGHwKS7mxjn6QcuRD644Pjn4F");
const PT_NEW = new PublicKey(process.env.SUCCESSOR_PT_MINT ?? "HgyWqTZ6JdGYF5TfrYmScTyvsyuopwYRJXwqA2LzCrz6");
const BASE_MINT = new PublicKey(process.env.BASE_MINT ?? "BULKoNSGzxtCqzwTvg5hFJg8fx6dqZRScyXe5LYMfxrn");
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
  console.log(`rolling ${withdrawUi} matured PT → new PT (wrapper_merge → swap → deposit)`);

  // Titan endpoint may be a bare host (e.g. "us.partners.api.titan.exchange"); the adapter
  // quotes over the WebSocket → normalize to wss://<host>/api/v1/ws (mirrors the app).
  const titanHost = process.env.TITAN_API_ENDPOINT || process.env.TITAN_GATEWAY_URL;
  if (!titanHost) {
    throw new Error("Set TITAN_API_ENDPOINT (+ TITAN_API_KEY) — base → PT_new needs the Titan aggregator.");
  }
  const bareHost = titanHost.replace(/^https?:\/\//, "").replace(/^wss?:\/\//, "").replace(/\/.*$/, "");
  const wsUrl = /^wss?:\/\//.test(titanHost) ? titanHost : `wss://${bareHost}/api/v1/ws`;
  const basePath = `https://${bareHost}/api/v1`;

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
    swapOpts: {
      swapConfig: {
        provider: SwapProvider.TITAN,
        slippageMode: "DYNAMIC",
        slippageBps: SLIPPAGE_BPS,
        platformFeeBps: 0,
        apiConfig: { basePath, wsUrl, apiKey: process.env.TITAN_API_KEY },
      },
    },
    // The whole Exponent redeem is internal: pass the matured market + the base token.
    // The roll's wrapper_merge + stake-pool refresh add many accounts, so a dedicated PT-roll
    // LUT (see create-pt-roll-lut.ts) compresses the flashloan under the tx size limit.
    rollOpts: {
      maturedMarket: MATURED_MARKET,
      baseMint: BASE_MINT,
      ...(process.env.PT_ROLL_LUT ? { lookupTable: new PublicKey(process.env.PT_ROLL_LUT) } : {}),
    },
  });

  console.log(`built ${transactions.length} tx(s), action tx index ${actionTxIndex}`);
  if (quoteResponse) {
    console.log(`  PT_new out (native): ${quoteResponse.outAmount}  via ${quoteResponse.provider}`);
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
