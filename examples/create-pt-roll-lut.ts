/**
 * Build (and optionally create on-chain) an address lookup table for Exponent PT roll-ups.
 *
 * A strip-based roll (withdraw → merge → strip → deposit) carries TWO Exponent SY-program
 * CPI account sets, which pushes the flashloan ~60 bytes past the legacy tx size limit. A
 * dedicated LUT covering the roll's Exponent accounts (programs + both vaults' merge/strip
 * accounts + shared SPL programs) compresses them away so the roll fits in one transaction.
 *
 * This script:
 *   1. collects the LUT account list for a given matured→successor roll,
 *   2. proves locally (synthetic LUT) that the strip roll now fits,
 *   3. if a funded keypair is provided (WALLET_PRIVATE_KEY in .env), creates + extends the
 *      real LUT on-chain and prints its address.
 *
 * Run: tsx create-pt-roll-lut.ts
 */

import { readFileSync } from "fs";
import { homedir } from "os";
import {
  AddressLookupTableAccount,
  AddressLookupTableProgram,
  Keypair,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";

import { Project0Client, MarginfiAccount, MarginfiAccountWrapper } from "../src";
import {
  resolveExponentMergeContext,
  resolveExponentStripContext,
  makeExponentMergeIx,
  makeExponentStripIx,
  EXPONENT_CORE_PROGRAM_ID,
  EXPONENT_GENERIC_SY_PROGRAM_ID,
  EXPONENT_CLMM_PROGRAM_ID,
  EXPONENT_ORDERBOOK_PROGRAM_ID,
  EXPONENT_VAULTS_PROGRAM_ID,
} from "../src/vendor/exponent";
import { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from "../src/vendor/spl";
import { makeRollPtTx } from "../src/services/account/actions/roll-pt";
import { getConnection, getMarginfiConfig, getWallet } from "./config";

/** Load the signer: WALLET_PRIVATE_KEY (.env) → SOLANA_KEYPAIR_PATH → ~/.config/solana/id.json. */
function loadSigner(): Keypair | null {
  const fromEnv = getWallet();
  if (fromEnv) return fromEnv;
  const path = process.env.SOLANA_KEYPAIR_PATH ?? `${homedir()}/.config/solana/id.json`;
  try {
    return Keypair.fromSecretKey(Buffer.from(JSON.parse(readFileSync(path, "utf8"))));
  } catch {
    return null;
  }
}

// The roll this LUT serves.
const ACCOUNT = new PublicKey("Ea5Aa6E94o2wF1msyjZWokEGsMJVqdeuCrsy7FfY8upE");
const MATURED_MARKET = new PublicKey("scSc4o3AkRoW6uooY3M54GUstZnYb4fADieeWz8AYco");
const MATURED_PT_BANK = new PublicKey("9ThXmfwhNzc6qbkRLuSGHwKS7mxjn6QcuRD644Pjn4F");
const SUCCESSOR_VAULT = new PublicKey("BwBn7Sro6RzDp3A59cDC7WoxWdT7yTaWuaHwvR7Gvypa");
const PT_NEW = new PublicKey("HgyWqTZ6JdGYF5TfrYmScTyvsyuopwYRJXwqA2LzCrz6");
const WITHDRAW_PT_UI = 500;

const uniq = (keys: PublicKey[]) => {
  const seen = new Set<string>();
  return keys.filter((k) => (seen.has(k.toBase58()) ? false : (seen.add(k.toBase58()), true)));
};

async function main() {
  const connection = getConnection();
  const client = await Project0Client.initialize(connection, getMarginfiConfig());
  const account = await MarginfiAccount.fetch(ACCOUNT, client.program);
  const wrapper = new MarginfiAccountWrapper(account, client);
  const authority = account.authority;

  const maturedBank = client.bankMap.get(MATURED_PT_BANK.toBase58())!;
  const successorBank = [...client.bankMap.values()].find((b) => b.mint.equals(PT_NEW))!;
  const maturedMint = await wrapper.getMintDataFromBank(maturedBank);
  const successorMint = await wrapper.getMintDataFromBank(successorBank);

  // Resolve the roll's two Exponent legs to harvest their account keys.
  const merge = await resolveExponentMergeContext({ connection, owner: authority, market: MATURED_MARKET });
  const withdrawNative = BigInt(Math.floor(WITHDRAW_PT_UI * 10 ** maturedBank.mintDecimals));
  const redeemedSy = merge.computeRedeemedAmountNative(withdrawNative);
  const mergeIx = makeExponentMergeIx(merge.mergeAccounts, redeemedSy);

  const strip = await resolveExponentStripContext({ connection, owner: authority, vault: SUCCESSOR_VAULT });
  const stripIx = makeExponentStripIx(strip.stripAccounts, redeemedSy);

  // LUT account list: shared programs + both legs' accounts + bank/mint accounts. Exclude
  // the owner (a signer can't be loaded from a LUT) — everything else is stable per market.
  const lutAccounts = uniq([
    EXPONENT_CORE_PROGRAM_ID,
    EXPONENT_GENERIC_SY_PROGRAM_ID,
    EXPONENT_CLMM_PROGRAM_ID,
    EXPONENT_ORDERBOOK_PROGRAM_ID,
    EXPONENT_VAULTS_PROGRAM_ID,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
    SUCCESSOR_VAULT,
    PT_NEW,
    successorBank.address,
    maturedBank.address,
    ...mergeIx.keys.map((k) => k.pubkey),
    ...stripIx.keys.map((k) => k.pubkey),
  ]).filter((k) => !k.equals(authority));
  console.log(`LUT will hold ${lutAccounts.length} accounts`);

  // --- Local proof: synthetic LUT makes the strip roll fit -------------------------------
  const synthetic = new AddressLookupTableAccount({
    key: PublicKey.default,
    state: {
      deactivationSlot: BigInt("18446744073709551615"),
      lastExtendedSlot: 0,
      lastExtendedSlotStartIndex: 0,
      authority: undefined,
      addresses: lutAccounts,
    },
  });
  const successorVaultAlt = strip.addressLookupTable;
  try {
    const { transactions } = await makeRollPtTx({
      program: client.program,
      marginfiAccount: account,
      connection,
      bankMap: client.bankMap,
      oraclePrices: (client as any).oraclePriceByBank,
      bankMetadataMap: (client as any).bankIntegrationMap,
      assetShareValueMultiplierByBank: new Map(),
      withdrawOpts: { totalPositionAmount: 6000, withdrawAmount: WITHDRAW_PT_UI, withdrawBank: maturedBank, tokenProgram: maturedMint.tokenProgram },
      depositOpts: { depositBank: successorBank, tokenProgram: successorMint.tokenProgram },
      addressLookupTableAccounts: client.addressLookupTables,
      // Pass the pre-built strip via the `buy` escape hatch + the synthetic LUT so we measure
      // the exact flashloan this LUT will serve (merge is resolved internally from maturedMarket).
      rollOpts: {
        maturedMarket: MATURED_MARKET,
        buy: {
          instructions: [stripIx],
          lookupTables: [synthetic, successorVaultAlt].filter(Boolean) as any,
          ptOutNative: (strip.computeStrippedPtNative(redeemedSy) * 9999n) / 10000n,
        },
      },
    });
    console.log(`✅ with the LUT, the strip roll fits — built ${transactions.length} tx(s)`);
  } catch (e: any) {
    console.log(`❌ still oversized: ${e?.message}`);
    return;
  }

  // --- Optional: create the LUT on-chain (needs a funded keypair) ------------------------
  const wallet = loadSigner();
  if (!wallet) {
    console.log("\n(no signer found → skipping on-chain creation)");
    console.log("LUT accounts:");
    lutAccounts.forEach((k) => console.log("  " + k.toBase58()));
    return;
  }
  const bal = await connection.getBalance(wallet.publicKey);
  console.log(`\nsigner ${wallet.publicKey.toBase58()} balance ${(bal / 1e9).toFixed(4)} SOL`);
  if (bal < 0.011e9) {
    console.log(`⚠️ need ~0.01 SOL (LUT rent + fees); fund this address, then re-run. Skipping.`);
    return;
  }
  const slot = await connection.getSlot("finalized");
  const [createIx, lutAddress] = AddressLookupTableProgram.createLookupTable({
    authority: wallet.publicKey,
    payer: wallet.publicKey,
    recentSlot: slot,
  });

  // Chunk the addresses into ≤20-per-extend; first tx also creates the table.
  const CHUNK = 20;
  const chunks: PublicKey[][] = [];
  for (let i = 0; i < lutAccounts.length; i += CHUNK) chunks.push(lutAccounts.slice(i, i + CHUNK));

  for (let i = 0; i < chunks.length; i++) {
    const extendIx = AddressLookupTableProgram.extendLookupTable({
      payer: wallet.publicKey,
      authority: wallet.publicKey,
      lookupTable: lutAddress,
      addresses: chunks[i],
    });
    const bh = (await connection.getLatestBlockhash()).blockhash;
    const tx = new VersionedTransaction(
      new TransactionMessage({
        payerKey: wallet.publicKey,
        recentBlockhash: bh,
        instructions: i === 0 ? [createIx, extendIx] : [extendIx],
      }).compileToV0Message()
    );
    tx.sign([wallet]);
    const sig = await connection.sendTransaction(tx);
    await connection.confirmTransaction(sig, "confirmed");
    console.log(`  extend ${i + 1}/${chunks.length} (${chunks[i].length} accts) sig ${sig}`);
  }
  console.log(`\n✅ created PT-roll LUT ${lutAddress.toBase58()} with ${lutAccounts.length} accounts`);
  console.log("   pass it via makeRollPtTx({ rollOpts: { lookupTables: [thisLut, vaultAlt, mergeAlt], ... } })");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
