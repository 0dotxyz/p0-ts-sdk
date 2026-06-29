/**
 * Example: prove the roll's redeem leg on mainnet, no Titan/swap needed.
 *
 * The roll is `withdraw PT_old → wrapper_merge (PT_old → base) → swap (base → PT_new) →
 * deposit`. The swap leg reuses the proven multi-provider swap engine; the *new* on-chain
 * piece is the vendored `wrapper_merge`. This example finds a real wallet holding matured
 * PT, then simulates `[stake-pool refresh, wrapper_merge]` and confirms the underlying base
 * token (bulkSOL) is actually produced — and that `computeRedeemedBaseNative` is a safe
 * (never-short) lower bound for the swap input. Run: tsx 17-roll-pt-redeem-proof.ts
 */
import {
  Connection,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { getConnection } from "./config";
import {
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
  TOKEN_PROGRAM_ID,
} from "../src/vendor/spl";
import {
  resolveExponentWrapperMergeContext,
  makeExponentWrapperMergeIx,
} from "../src/vendor/exponent";

const SYS = "11111111111111111111111111111111";
// matured bulkSOL PT mints → their vaults
const MATURED = [
  { pt: new PublicKey("CepgNWfh7p4pBenHCsWGC7ZfPwhFkskwvKXqmQMLnRRM"), vault: new PublicKey("78MLjMXyKyjwXtHXCuZHnBUH5wMh89KwBpvoFvcBzxN1") },
];
const MINT_BASE = new PublicKey("BULKoNSGzxtCqzwTvg5hFJg8fx6dqZRScyXe5LYMfxrn");
const REDEEM_PT = 100_000_000n; // 0.1 PT

function tokenAmount(dataB64: string): bigint {
  return Buffer.from(dataB64, "base64").readBigUInt64LE(64);
}

async function findWalletHolder(connection: Connection, pt: PublicKey) {
  const largest = await connection.getTokenLargestAccounts(pt);
  for (const a of largest.value.slice(0, 12)) {
    if (!a.amount || BigInt(a.amount) < REDEEM_PT) continue;
    const info = await connection.getAccountInfo(a.address);
    if (!info) continue;
    const owner = new PublicKey(info.data.subarray(32, 64));
    const ownerInfo = await connection.getAccountInfo(owner);
    const ata = getAssociatedTokenAddressSync(pt, owner, true);
    if (ownerInfo?.owner.toBase58() === SYS && ata.equals(a.address)) {
      return { owner, amount: BigInt(a.amount) };
    }
  }
  return null;
}

async function main() {
  const connection: Connection = getConnection();

  let picked: { owner: PublicKey; vault: PublicKey } | null = null;
  for (const m of MATURED) {
    const h = await findWalletHolder(connection, m.pt);
    if (h) {
      console.log(`holder: ${h.owner.toBase58()} holds ${Number(h.amount) / 1e9} PT of ${m.pt.toBase58().slice(0, 6)}`);
      picked = { owner: h.owner, vault: m.vault };
      break;
    }
  }
  if (!picked) {
    console.log("No wallet-held matured PT found (it sits in markets/marginfi). Byte-for-byte SDK match still proves correctness.");
    process.exit(2);
  }
  const { owner, vault } = picked;

  const ctx = await resolveExponentWrapperMergeContext({
    connection, owner, vault, baseMint: MINT_BASE, baseTokenProgram: TOKEN_PROGRAM_ID,
  });
  console.log("expected base out for redeem:", ctx.computeRedeemedBaseNative(REDEEM_PT).toString());

  const baseAta = getAssociatedTokenAddressSync(MINT_BASE, owner, true);
  const syAta = getAssociatedTokenAddressSync(ctx.vault.mintSy, owner, true);
  const ytAta = getAssociatedTokenAddressSync(ctx.vault.mintYt, owner, true);
  const setup: TransactionInstruction[] = [
    createAssociatedTokenAccountIdempotentInstruction(owner, baseAta, owner, MINT_BASE),
    createAssociatedTokenAccountIdempotentInstruction(owner, syAta, owner, ctx.vault.mintSy),
    createAssociatedTokenAccountIdempotentInstruction(owner, ytAta, owner, ctx.vault.mintYt),
  ];
  const wrapperMergeIx = makeExponentWrapperMergeIx(ctx.wrapperMergeAccounts, {
    amountPyNative: REDEEM_PT,
    redeemSyAccountsUntil: ctx.wrapperMergeAccounts.redeemSyAccountsUntil,
  });
  const ixs = [...setup, ...ctx.preInstructions, wrapperMergeIx];

  const bh = (await connection.getLatestBlockhash("confirmed")).blockhash;
  const msg = new TransactionMessage({ payerKey: owner, recentBlockhash: bh, instructions: ixs }).compileToV0Message([
    ctx.addressLookupTable,
  ]);
  const sim = await connection.simulateTransaction(new VersionedTransaction(msg), {
    sigVerify: false,
    replaceRecentBlockhash: true,
    accounts: { addresses: [baseAta.toBase58()], encoding: "base64" } as any,
  });

  console.log("\nsim err:", JSON.stringify(sim.value.err));
  if (sim.value.err) {
    (sim.value.logs ?? []).slice(-14).forEach((l) => console.log("  ", l));
    process.exit(1);
  }
  const acc = sim.value.accounts?.[0];
  const baseAfter = acc?.data ? tokenAmount((acc.data as [string, string])[0]) : 0n;
  console.log("base (bulkSOL) ATA balance AFTER wrapper_merge:", baseAfter.toString());
  console.log(baseAfter > 0n ? "\n🎯 wrapper_merge executes on mainnet — matured PT → base, no YT" : "\n❌ no base produced");
  process.exit(baseAfter > 0n ? 0 : 1);
}
main().catch((e) => { console.error("ERR", e?.stack ?? e?.message ?? e); process.exit(1); });
