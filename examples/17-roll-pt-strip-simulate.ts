/**
 * Example: Roll a matured Exponent PT into its next maturity via STRIP, and simulate it
 * end-to-end against mainnet — works even for a leveraged, "underwater-on-paper" position.
 *
 *   withdraw PT_old → merge (PT_old → SY) → STRIP (SY → PT_new + YT_new) → deposit PT_new
 *
 * Why strip (not an AMM swap): PT_new is *minted* via `strip`, 1:1 against the vault — so the
 * roll is NOT bounded by the successor market's pool depth (the CLMM pool here holds ~410 PT;
 * strip mints thousands). For a leveraged position whose matured PT bank went `ReduceOnly`
 * (asset weight 0), this is the only way to roll enough collateral in one flash loan to clear
 * the end-of-flashloan init-health check.
 *
 * Size: a strip roll carries TWO Exponent SY-program CPI account sets (merge + strip), which
 * overflows a single legacy transaction. A dedicated PT-roll address lookup table fixes that
 * (create it with `create-pt-roll-lut.ts`); PT_ROLL_LUT below is the one created for this pair.
 *
 * The setup/crank txs must land before the flashloan, so we simulate the whole sequence as a
 * `simulateBundle` (chained state). Run: tsx 17-roll-pt-strip-simulate.ts  (ROLL_PT=6400 to cap)
 */

import { PublicKey } from "@solana/web3.js";
import { Project0Client, MarginfiAccount, MarginfiAccountWrapper } from "../src";
import { getConnection, getMarginfiConfig } from "./config";

const PT_ROLL_LUT = new PublicKey("6V2usBDydfu3f6wmEmJpDUUuHHF7xrbhpw8oTA7wAWtF");
const ACCOUNT = new PublicKey("Ea5Aa6E94o2wF1msyjZWokEGsMJVqdeuCrsy7FfY8upE");
const MATURED_MARKET = new PublicKey("scSc4o3AkRoW6uooY3M54GUstZnYb4fADieeWz8AYco");
const MATURED_PT_BANK = new PublicKey("9ThXmfwhNzc6qbkRLuSGHwKS7mxjn6QcuRD644Pjn4F");
const SUCCESSOR_VAULT = new PublicKey("BwBn7Sro6RzDp3A59cDC7WoxWdT7yTaWuaHwvR7Gvypa");
const PT_NEW = new PublicKey("HgyWqTZ6JdGYF5TfrYmScTyvsyuopwYRJXwqA2LzCrz6");

async function main() {
  const connection = getConnection();
  const client = await Project0Client.initialize(connection, getMarginfiConfig());
  const account = await MarginfiAccount.fetch(ACCOUNT, client.program);
  const wrapper = new MarginfiAccountWrapper(account, client);

  const maturedBank = client.bankMap.get(MATURED_PT_BANK.toBase58())!;
  const successorBank = [...client.bankMap.values()].find((b) => b.mint.equals(PT_NEW))!;
  const maturedMint = await wrapper.getMintDataFromBank(maturedBank);
  const successorMint = await wrapper.getMintDataFromBank(successorBank);

  const positionUi = account.balances
    .find((b) => b.bankPk.equals(MATURED_PT_BANK))!
    .computeQuantityUi(maturedBank).assets.toNumber();
  const withdrawUi = Number(process.env.ROLL_PT ?? String(positionUi)); // default: FULL roll
  console.log(`rolling ${withdrawUi.toFixed(0)} matured PT (merge → strip → deposit)`);

  // The whole Exponent flow is internal now: pass the markets + the PT-roll LUT and
  // makeRollPtTx resolves the merge, builds the strip buy leg, sizes the deposit, and
  // assembles the lookup tables. Same call shape as makeSwapCollateralTx (the wrapper
  // auto-injects program / marginfiAccount / bankMap / oraclePrices / bankMetadataMap / LUTs).
  const { transactions } = await wrapper.makeRollPtTx({
    connection,
    assetShareValueMultiplierByBank: new Map(),
    withdrawOpts: { totalPositionAmount: positionUi, withdrawAmount: withdrawUi, withdrawBank: maturedBank, tokenProgram: maturedMint.tokenProgram },
    depositOpts: { depositBank: successorBank, tokenProgram: successorMint.tokenProgram },
    rollOpts: {
      maturedMarket: MATURED_MARKET,
      successorVault: SUCCESSOR_VAULT,
      lookupTable: PT_ROLL_LUT,
      slippageBps: 10,
    },
  });
  console.log(`built ${transactions.length} txs`);

  const bh = (await connection.getLatestBlockhash("confirmed")).blockhash;
  const encoded = transactions.map((tx) => { tx.message.recentBlockhash = bh; return Buffer.from(tx.serialize()).toString("base64"); });
  const nulls = encoded.map(() => null);
  const res = await fetch(process.env.SOLANA_RPC_URL!, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "simulateBundle",
      params: [{ encodedTransactions: encoded }, { preExecutionAccountsConfigs: nulls, postExecutionAccountsConfigs: nulls, skipSigVerify: true }] }),
  }).then((r) => r.json());
  if (res.error) { console.log("bundle err:", JSON.stringify(res.error)); return; }
  const results = res.result?.value?.transactionResults ?? res.result?.transactionResults ?? [];
  results.forEach((t: any, i: number) => console.log(`  tx[${i}] err: ${JSON.stringify(t.err ?? null)}`));
  console.log(results.length && results.every((t: any) => !t.err) ? "\n✅ FULL strip roll simulated successfully — account restored above water" : "\n❌ failed");
}
main().catch((e) => { console.error("ERR", e?.stack ?? e?.message ?? e); process.exit(1); });
