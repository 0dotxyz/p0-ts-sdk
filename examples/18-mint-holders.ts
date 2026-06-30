/**
 * Example: Find every account holding a mint and its balance
 *
 * This example shows how to:
 * 1. Initialize the Project0Client from config
 * 2. List the addresses of all accounts holding a specific bank
 *    (client.getAccountAddressesHoldingBank)
 * 3. Fetch the authority + deposited/borrowed amounts for every account holding a mint
 *    (client.getAuthorityBalancesForMint)
 *
 * Under the hood both scan all 16 balance slots of the group's accounts via filtered
 * getProgramAccounts calls, so they work even with ~500k accounts. The addresses-only call is
 * cheap (no account data transferred); the balances call fetches + decodes full accounts, so it
 * is heavier for a widely-held mint — use the `concurrency` option to stay under RPC limits.
 *
 * Setup:
 * 1. Copy .env.example to .env
 * 2. Fill in your configuration values
 * 3. Run: tsx 18-mint-holders.ts            (defaults to USDC)
 *    Or:  tsx 18-mint-holders.ts <MINT>     (any mint address)
 */

import { PublicKey } from "@solana/web3.js";
import BigNumber from "bignumber.js";

import { Project0Client, AssetTag } from "../src";
import { getConnection, getMarginfiConfig, MINTS } from "./config";

// ============================================================================
// Config
// ============================================================================

// Mint to inspect: first CLI arg, else USDC. (USDC is widely held — expect a large result set.)
const MINT = new PublicKey(process.argv[2] ?? MINTS.USDC);

// How many of the 16 per-bank slot scans to run at once. Lower this if your RPC rate-limits.
const CONCURRENCY = process.env.HOLDERS_CONCURRENCY
  ? Number(process.env.HOLDERS_CONCURRENCY)
  : 8;

// How many rows to print (the full result set can be very large).
const PRINT_LIMIT = 20;

// ============================================================================
// Main Example
// ============================================================================

async function mintHoldersExample() {
  // --------------------------------------------------------------------------
  // Step 1: Initialize Client
  // --------------------------------------------------------------------------
  console.log("\n🔧 Loading configuration...");
  const connection = getConnection();
  const config = getMarginfiConfig();
  console.log(`   RPC: ${connection.rpcEndpoint}`);

  console.log("\n📡 Initializing Project0Client...");
  const client = await Project0Client.initialize(connection, config);
  console.log(`✅ Client initialized with ${client.banks.length} banks`);

  // --------------------------------------------------------------------------
  // Step 2: Resolve the mint to its bank(s)
  // --------------------------------------------------------------------------
  const banks = client.getBanksByMint(MINT);
  console.log(`\n🪙 Mint ${MINT.toBase58()}`);
  if (banks.length === 0) {
    console.error("   ❌ No banks found for this mint in the configured group. Exiting.");
    return;
  }
  console.log(`   Maps to ${banks.length} bank(s):`);
  banks.forEach((bank) => {
    console.log(
      `     • ${bank.address.toBase58()}  ` +
        `[${AssetTag[bank.config.assetTag] ?? bank.config.assetTag}]  ` +
        `${bank.tokenSymbol ?? ""}`
    );
  });

  // --------------------------------------------------------------------------
  // Step 3: Addresses-only — accounts holding the first bank
  // --------------------------------------------------------------------------
  const firstBank = banks[0];
  console.log(
    `\n🔎 Scanning accounts holding bank ${firstBank.address.toBase58()} (addresses only)...`
  );
  const addresses = await client.getAccountAddressesHoldingBank(firstBank.address, {
    concurrency: CONCURRENCY,
  });
  console.log(`   ✅ ${addresses.length} account(s) hold this bank`);
  addresses.slice(0, 5).forEach((a) => console.log(`     - ${a.toBase58()}`));
  if (addresses.length > 5) console.log(`     ... and ${addresses.length - 5} more`);

  // --------------------------------------------------------------------------
  // Step 4: Authority balances for the whole mint (across all its banks)
  // --------------------------------------------------------------------------
  console.log(`\n📊 Fetching authority balances for the mint (UI units)...`);
  const t0 = Date.now();
  const rows = await client.getAuthorityBalancesForMint(MINT, {
    concurrency: CONCURRENCY,
    // assetTag: AssetTag.KAMINO, // <- uncomment to restrict to a specific bank flavor
  });
  console.log(`   ✅ ${rows.length} (account, bank) row(s) in ${Date.now() - t0}ms`);

  // --------------------------------------------------------------------------
  // Step 5: Summaries
  // --------------------------------------------------------------------------
  const totalDeposited = rows.reduce((s, r) => s.plus(r.assets), new BigNumber(0));
  const totalBorrowed = rows.reduce((s, r) => s.plus(r.liabilities), new BigNumber(0));
  const depositorCount = rows.filter((r) => r.assets.gt(0)).length;
  const borrowerCount = rows.filter((r) => r.liabilities.gt(0)).length;
  const uniqueAuthorities = new Set(rows.map((r) => r.authority.toBase58())).size;

  const sym = firstBank.tokenSymbol ?? "tokens";
  console.log(`\n📈 Summary for mint ${MINT.toBase58()}`);
  console.log(`   Unique authorities : ${uniqueAuthorities}`);
  console.log(`   Depositors         : ${depositorCount}`);
  console.log(`   Borrowers          : ${borrowerCount}`);
  console.log(`   Total deposited    : ${totalDeposited.toFixed(2)} ${sym}`);
  console.log(`   Total borrowed     : ${totalBorrowed.toFixed(2)} ${sym}`);

  // --------------------------------------------------------------------------
  // Step 6: Top depositors
  // --------------------------------------------------------------------------
  const topByDeposit = [...rows]
    .sort((a, b) => b.assets.comparedTo(a.assets) ?? 0)
    .slice(0, PRINT_LIMIT);

  console.log(`\n🏆 Top ${topByDeposit.length} positions by deposited amount:`);
  topByDeposit.forEach((r, i) => {
    console.log(
      `   ${String(i + 1).padStart(2)}. ${r.authority.toBase58()}\n` +
        `       account: ${r.accountAddress.toBase58()}\n` +
        `       bank:    ${r.bank.toBase58()}\n` +
        `       assets:  ${r.assets.toFixed(6)} ${sym}   ` +
        `liabilities: ${r.liabilities.toFixed(6)} ${sym}`
    );
  });
}

// ============================================================================
// Run Example
// ============================================================================

mintHoldersExample()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n❌ Error:", error);
    process.exit(1);
  });
