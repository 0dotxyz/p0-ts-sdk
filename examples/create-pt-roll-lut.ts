/**
 * Create the single dedicated PT-roll address lookup table for a roll.
 *
 * The roll's flashloan is account-heavy (`wrapper_merge` ~35 keys + marginfi withdraw/deposit),
 * so the swap engine's Titan template is cleanest with ONE LUT that covers the entire non-swap
 * footprint. This harvests every account in `withdraw → wrapper_merge → deposit` (minus the
 * authority signer) and packs it into a single LUT; pass its address via `rollOpts.lookupTable`.
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
import { resolveExponentWrapperMergeContext, makeExponentWrapperMergeIx } from "../src/vendor/exponent";
import { makeWithdrawIx } from "../src/services/account/actions/withdraw";
import { makeDepositIx } from "../src/services/account/actions/deposit";

const MATURED_MARKET = new PublicKey(process.env.MATURED_PT_MARKET ?? "scSc4o3AkRoW6uooY3M54GUstZnYb4fADieeWz8AYco");
const MATURED_PT_BANK = new PublicKey(process.env.MATURED_PT_BANK ?? "9ThXmfwhNzc6qbkRLuSGHwKS7mxjn6QcuRD644Pjn4F");
const PT_NEW = new PublicKey(process.env.SUCCESSOR_PT_MINT ?? "HgyWqTZ6JdGYF5TfrYmScTyvsyuopwYRJXwqA2LzCrz6");
const BASE_MINT = new PublicKey(process.env.BASE_MINT ?? "BULKoNSGzxtCqzwTvg5hFJg8fx6dqZRScyXe5LYMfxrn");

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

  // Build the exact flashloan non-swap footprint and harvest its accounts.
  const ctx = await resolveExponentWrapperMergeContext({ connection, owner: authority, market: MATURED_MARKET, baseMint: BASE_MINT, baseTokenProgram: TOKEN_PROGRAM_ID, ptYtTokenProgram: mMint.tokenProgram });
  const wm = makeExponentWrapperMergeIx(ctx.wrapperMergeAccounts, { amountPyNative: 1n, redeemSyAccountsUntil: ctx.wrapperMergeAccounts.redeemSyAccountsUntil });
  const withdraw = await makeWithdrawIx({ program: client.program, bank: maturedBank, bankMap: client.bankMap, tokenProgram: mMint.tokenProgram, amount: 1, marginfiAccount: account, authority, withdrawAll: false, bankMetadataMap: client.bankIntegrationMap, isSync: true, opts: { createAtas: false, wrapAndUnwrapSol: false, overrideInferAccounts: { authority, group: account.group } } });
  const deposit = await makeDepositIx({ program: client.program, bank: successorBank, tokenProgram: sMint.tokenProgram, amount: 1, accountAddress: account.address, authority, group: account.group, isSync: true, opts: { wrapAndUnwrapSol: false, overrideInferAccounts: { authority, group: account.group } } });

  const keys = new Set<string>();
  for (const ix of [...withdraw.instructions, wm, ...deposit.instructions, ...ctx.preInstructions]) {
    keys.add(ix.programId.toBase58());
    for (const k of ix.keys) keys.add(k.pubkey.toBase58());
  }
  // The authority is always a static signer; everything else can live in the LUT.
  const addresses = [...keys].filter((k) => k !== authority.toBase58()).map((k) => new PublicKey(k));
  console.log(`LUT will hold ${addresses.length} accounts (full non-swap footprint)`);

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
