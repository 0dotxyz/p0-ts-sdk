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
  address,
  assertIsTransactionWithBlockhashLifetime,
  createKeyPairSignerFromBytes,
  createSolanaRpcSubscriptions,
  getSignatureFromTransaction,
  sendAndConfirmTransactionFactory,
  signTransactionMessageWithSigners,
  type Address,
  type Instruction,
} from "@solana/kit";
import {
  findAddressLookupTablePda,
  getCreateLookupTableInstruction,
  getExtendLookupTableInstruction,
} from "@solana-program/address-lookup-table";
import { getSetComputeUnitPriceInstruction } from "@solana-program/compute-budget";
import { findAssociatedTokenPda } from "@solana-program/token";

import {
  Project0Client,
  MarginfiAccount,
  MarginfiAccountWrapper,
  makeTransactionMessage,
} from "../src";
import {
  makeExponentClmmTradePtIx,
  makeExponentMergeIx,
  resolveExponentClmmTradePtContext,
  resolveExponentMergeContext,
  SwapDirection,
} from "../src/vendor/exponent";
import { getRpc, getMarginfiConfig, getAccountAddress } from "./config";

const MATURED_MARKET = address(process.env.MATURED_PT_MARKET ?? "scSc4o3AkRoW6uooY3M54GUstZnYb4fADieeWz8AYco");
const MATURED_PT_BANK = address(process.env.MATURED_PT_BANK ?? "9ThXmfwhNzc6qbkRLuSGHwKS7mxjn6QcuRD644Pjn4F");
const PT_NEW = address(process.env.SUCCESSOR_PT_MINT ?? "HgyWqTZ6JdGYF5TfrYmScTyvsyuopwYRJXwqA2LzCrz6");
const SUCCESSOR_MARKET = address(process.env.SUCCESSOR_PT_MARKET ?? "7NSpRqs1ZNiZharyTwKyprfanQsaPprZSm1z84nVsbKn");

async function loadPayer() {
  const path = process.env.LUT_KEYPAIR;
  if (!path) throw new Error("Set LUT_KEYPAIR to a funded keypair file (JSON byte array)");
  return createKeyPairSignerFromBytes(Uint8Array.from(JSON.parse(readFileSync(path, "utf8"))));
}

async function main() {
  const { rpc, rpcEndpoint } = getRpc();
  const payer = await loadPayer();
  const client = await Project0Client.initialize({ rpc, rpcEndpoint }, getMarginfiConfig());
  const account = await MarginfiAccount.fetch(getAccountAddress(), rpc);
  const wrapper = new MarginfiAccountWrapper(account, client);
  const authority = wrapper.signer;
  const maturedBank = client.getBank(MATURED_PT_BANK)!;
  const successorBank = client.getBanksByMint(PT_NEW)[0]!;
  const mMint = await wrapper.getMintDataFromBank(maturedBank);
  const sMint = await wrapper.getMintDataFromBank(successorBank);

  // Build the exact flash-loan footprint and harvest its accounts.
  const merge = await resolveExponentMergeContext({ rpc, owner: authority.address, market: MATURED_MARKET, ptYtTokenProgram: mMint.tokenProgram });
  const clmm = await resolveExponentClmmTradePtContext({ rpc, owner: authority.address, market: SUCCESSOR_MARKET, ptTokenProgram: sMint.tokenProgram });
  const mergeIx = await makeExponentMergeIx({ ...merge.mergeInput, owner: authority, amount: 1n }, merge.remainingAccounts);
  const tradeIx = await makeExponentClmmTradePtIx(
    { ...clmm.tradePtInput, trader: authority, amountIn: 1n, swapDirection: SwapDirection.SyToPt, amountOutConstraint: 1n, priceSpotLimit: null },
    clmm.remainingAccounts
  );
  const withdrawIxs = await wrapper.makeWithdrawIx(maturedBank.address, 1, false, { createAta: false, unwrapSol: false });
  const depositIxs = await wrapper.makeDepositIx(successorBank.address, 1, { wrapSol: false });

  const keys = new Set<Address>();
  for (const ix of [...withdrawIxs, mergeIx, tradeIx, ...depositIxs]) {
    keys.add(ix.programAddress);
    for (const meta of ix.accounts ?? []) keys.add(meta.address);
  }
  // Exclude per-USER accounts so the LUT is SHAREABLE across all rollers of this pair: the
  // signer, the marginfi account, and the owner's ATAs (these differ per user / stay static).
  // Everything else (banks, the matured vault + merge accounts, the CLMM pool + its escrows /
  // ticks / fee treasuries, SY-CPI accounts, mints, programs) is shared per matured→successor pair.
  const ata = async (mint: Address, tokenProgram: Address) =>
    (await findAssociatedTokenPda({ mint, owner: authority.address, tokenProgram }))[0];
  const perUser = new Set<Address>([
    authority.address,
    account.address,
    await ata(maturedBank.mint, mMint.tokenProgram),
    await ata(merge.vault.mintYt, mMint.tokenProgram),
    await ata(successorBank.mint, sMint.tokenProgram),
    await ata(merge.underlying.mint, merge.underlying.tokenProgram), // shared SY
  ]);
  const addresses = [...keys].filter((k) => !perUser.has(k));
  console.log(`LUT will hold ${addresses.length} SHARED accounts (per-user accounts excluded)`);

  const recentSlot = await rpc.getSlot({ commitment: "finalized" }).send();
  const [lutAddress, bump] = await findAddressLookupTablePda({ authority: payer.address, recentSlot });
  console.log("LUT address:", lutAddress);

  const sendAndConfirm = sendAndConfirmTransactionFactory({
    rpc,
    rpcSubscriptions: createSolanaRpcSubscriptions(rpcEndpoint.replace(/^http/, "ws")),
  });
  const send = async (instructions: Instruction[], label: string) => {
    const { value: latestBlockhash } = await rpc.getLatestBlockhash({ commitment: "confirmed" }).send();
    const tx = await signTransactionMessageWithSigners(
      makeTransactionMessage({
        instructions: [getSetComputeUnitPriceInstruction({ microLamports: 50_000 }), ...instructions],
        feePayer: payer,
        latestBlockhash,
      })
    );
    assertIsTransactionWithBlockhashLifetime(tx);
    await sendAndConfirm(tx, { commitment: "confirmed" });
    console.log(`  ${label}: ${getSignatureFromTransaction(tx)}`);
  };
  const extend = (chunk: Address[]) =>
    getExtendLookupTableInstruction({ address: lutAddress, authority: payer, payer, addresses: chunk });

  await send(
    [getCreateLookupTableInstruction({ address: lutAddress, authority: payer, payer, recentSlot, bump }), extend(addresses.slice(0, 20))],
    "create + extend"
  );
  for (let i = 20; i < addresses.length; i += 20) {
    await send([extend(addresses.slice(i, i + 20))], `extend ${i}`);
  }
  console.log("\n✅ PT-roll LUT:", lutAddress);
}
main().catch((e) => { console.error("ERR", e?.stack ?? e?.message ?? e); process.exit(1); });
