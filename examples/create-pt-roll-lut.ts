/**
 * Create the single dedicated PT-roll address lookup table for a roll.
 *
 * The roll's flash loan is `withdraw → merge → CLMM trade_pt → deposit`. Account *locks* are
 * already comfortably under the limit (the CLMM swap is a fixed, compact set), so the LUT is
 * only about compressing *bytes* for headroom on larger positions. This harvests every account
 * in that footprint (minus per-user accounts) and packs it into ONE shareable LUT; pass its
 * address via `rollOpts.lookupTable`.
 *
 *   SOLANA_RPC_URL=... MARGINFI_ACCOUNT_ADDRESS=<acct> LUT_KEYPAIR=/path/funded.json \
 *   tsx create-pt-roll-lut.ts
 */
import { readFileSync } from "fs";
import {
  AddressLookupTableProgram,
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { Project0Client, MarginfiAccount, MarginfiAccountWrapper } from "../src";
import { getConnection, getMarginfiConfig, getAccountAddress } from "./config";
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from "../src/vendor/spl";
import {
  resolveExponentMergeContext,
  makeExponentMergeIx,
  resolveExponentClmmTradePtContext,
  makeExponentClmmTradePtIx,
  exponentClmmBuyPtArgs,
} from "../src/vendor/exponent";
import { makeWithdrawIx } from "../src/services/account/actions/withdraw";
import { makeDepositIx } from "../src/services/account/actions/deposit";

const MATURED_MARKET = new PublicKey(process.env.MATURED_PT_MARKET ?? "scSc4o3AkRoW6uooY3M54GUstZnYb4fADieeWz8AYco");
const MATURED_PT_BANK = new PublicKey(process.env.MATURED_PT_BANK ?? "9ThXmfwhNzc6qbkRLuSGHwKS7mxjn6QcuRD644Pjn4F");
const PT_NEW = new PublicKey(process.env.SUCCESSOR_PT_MINT ?? "HgyWqTZ6JdGYF5TfrYmScTyvsyuopwYRJXwqA2LzCrz6");
const SUCCESSOR_MARKET = new PublicKey(process.env.SUCCESSOR_PT_MARKET ?? "7NSpRqs1ZNiZharyTwKyprfanQsaPprZSm1z84nVsbKn");

function loadKeypair(): Keypair {
  const p = process.env.LUT_KEYPAIR ?? "/home/kobe/develop/p0/aatGhKor24nSnf1hPYbzRCPD2YWLfFLC2X6G69a2Rzw.json";
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(p, "utf8"))));
}

async function main() {
  const connection = getConnection();
  const payer = loadKeypair();
  const client = await Project0Client.initialize(connection, getMarginfiConfig());
  const account = await MarginfiAccount.fetch(getAccountAddress(), client.program);
  const wrapper = new MarginfiAccountWrapper(account, client);
  const authority = account.authority;
  const maturedBank = client.bankMap.get(MATURED_PT_BANK.toBase58())!;
  const successorBank = [...client.bankMap.values()].find((b) => b.mint.equals(PT_NEW))!;
  const mMint = await wrapper.getMintDataFromBank(maturedBank);
  const sMint = await wrapper.getMintDataFromBank(successorBank);

  // Build the exact flash-loan footprint and harvest its accounts.
  const merge = await resolveExponentMergeContext({ connection, owner: authority, market: MATURED_MARKET, ptYtTokenProgram: mMint.tokenProgram });
  const clmm = await resolveExponentClmmTradePtContext({ connection, owner: authority, market: SUCCESSOR_MARKET, ptTokenProgram: sMint.tokenProgram });
  const mergeIx = makeExponentMergeIx(merge.mergeAccounts, 1n);
  const tradeIx = makeExponentClmmTradePtIx(clmm.tradePtAccounts, exponentClmmBuyPtArgs({ amountInSyNative: 1n, minPtOutNative: 1n }));
  const withdraw = await makeWithdrawIx({ program: client.program, bank: maturedBank, bankMap: client.bankMap, tokenProgram: mMint.tokenProgram, amount: 1, marginfiAccount: account, authority, withdrawAll: false, bankMetadataMap: client.bankIntegrationMap, isSync: true, opts: { createAtas: false, wrapAndUnwrapSol: false, overrideInferAccounts: { authority, group: account.group } } });
  const deposit = await makeDepositIx({ program: client.program, bank: successorBank, tokenProgram: sMint.tokenProgram, amount: 1, accountAddress: account.address, authority, group: account.group, isSync: true, opts: { wrapAndUnwrapSol: false, overrideInferAccounts: { authority, group: account.group } } });

  const keys = new Set<string>();
  for (const ix of [...withdraw.instructions, mergeIx, tradeIx, ...deposit.instructions]) {
    keys.add(ix.programId.toBase58());
    for (const k of ix.keys) keys.add(k.pubkey.toBase58());
  }
  // Exclude per-USER accounts so the LUT is SHAREABLE across all rollers of this pair: the
  // signer, the marginfi account, and the owner's ATAs (these differ per user / stay static).
  // Everything else (banks, the matured vault + merge accounts, the CLMM pool + its escrows /
  // ticks / fee treasuries, SY-CPI accounts, mints, programs) is shared per matured→successor pair.
  const ata = (mint: PublicKey) => getAssociatedTokenAddressSync(mint, authority, true).toBase58();
  const perUser = new Set<string>([
    authority.toBase58(),
    account.address.toBase58(),
    ata(maturedBank.mint),
    ata(successorBank.mint),
    ata(merge.underlying.mint), // shared SY
  ]);
  const addresses = [...keys].filter((k) => !perUser.has(k)).map((k) => new PublicKey(k));
  console.log(`LUT will hold ${addresses.length} SHARED accounts (per-user accounts excluded)`);

  const slot = await connection.getSlot("finalized");
  const [createIx, lutAddress] = AddressLookupTableProgram.createLookupTable({ authority: payer.publicKey, payer: payer.publicKey, recentSlot: slot });
  console.log("LUT address:", lutAddress.toBase58());

  const send = async (ixs: any[], label: string) => {
    const bh = (await connection.getLatestBlockhash("confirmed")).blockhash;
    const tx = new VersionedTransaction(new TransactionMessage({ payerKey: payer.publicKey, recentBlockhash: bh, instructions: [ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000 }), ...ixs] }).compileToV0Message());
    tx.sign([payer]);
    const sig = await connection.sendTransaction(tx, { skipPreflight: false });
    await connection.confirmTransaction(sig, "confirmed");
    console.log(`  ${label}: ${sig}`);
  };

  await send([createIx, AddressLookupTableProgram.extendLookupTable({ payer: payer.publicKey, authority: payer.publicKey, lookupTable: lutAddress, addresses: addresses.slice(0, 20) })], "create + extend");
  for (let i = 20; i < addresses.length; i += 20) {
    await send([AddressLookupTableProgram.extendLookupTable({ payer: payer.publicKey, authority: payer.publicKey, lookupTable: lutAddress, addresses: addresses.slice(i, i + 20) })], `extend ${i}`);
  }
  console.log("\n✅ PT-roll LUT:", lutAddress.toBase58());
}
main().catch((e) => { console.error("ERR", e?.stack ?? e?.message ?? e); process.exit(1); });
