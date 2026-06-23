/**
 * Example: Roll a matured Exponent PT collateral position into its next maturity
 * (SIMULATION MODE) — the native, no-unwrap path.
 *
 * Exponent's SY is the protocol's internal unit of account and is maturity-independent
 * (the same SY mint backs every maturity of an underlying). So a roll never has to leave
 * SY — no unwrap to the base token, no external aggregator:
 *
 *     withdraw PT_old → merge (PT_old → SY, 1:1) → trade_pt (SY → PT_new) → deposit PT_new
 *
 * This example shows how to:
 *   1. resolve the matured vault's `merge` accounts + redeemed SY amount
 *   2. resolve the successor market's `trade_pt` accounts (+ its address lookup table)
 *   3. quote the SY → PT_new buy leg (see `quotePtOutNative` below)
 *   4. build the flash-loan-wrapped roll with `makeRollPtTx`
 *
 * Setup:
 *   1. Copy .env.example to .env
 *   2. Fill in MARGINFI_ACCOUNT_ADDRESS and WALLET_ADDRESS (no private key needed)
 *   3. Run: tsx 15-roll-pt.ts
 *
 * Note: SIMULATION mode — no transactions are sent.
 */

import { PublicKey } from "@solana/web3.js";

import { Project0Client, MarginfiAccountWrapper, MarginfiAccount } from "../src";
import {
  resolveExponentMergeContext,
  resolveExponentTradePtContext,
  makeExponentTradePtIx,
  exponentBuyPtArgs,
} from "../src/vendor/exponent";
import {
  getConnection,
  getMarginfiConfig,
  getAccountAddress,
  getWalletPubkey,
} from "./config";

// ============================================================================
// Configuration — fill in the two PT markets you are rolling between.
// ============================================================================

// The matured PT's Exponent `MarketTwo` (its vault is read for the `merge`).
const MATURED_MARKET = new PublicKey(
  process.env.MATURED_PT_MARKET ?? "11111111111111111111111111111111"
);
// The successor (next-maturity) PT's Exponent `MarketTwo` (where SY → PT_new trades).
const SUCCESSOR_MARKET = new PublicKey(
  process.env.SUCCESSOR_PT_MARKET ?? "11111111111111111111111111111111"
);

// The matured + successor PT collateral banks (marginfi banks holding each PT).
const MATURED_PT_BANK = new PublicKey(
  process.env.MATURED_PT_BANK ?? "11111111111111111111111111111111"
);
const SUCCESSOR_PT_BANK = new PublicKey(
  process.env.SUCCESSOR_PT_BANK ?? "11111111111111111111111111111111"
);

// Slippage floor applied to the trade_pt buy leg (1% here).
const BUY_SLIPPAGE_BPS = 100;

/**
 * Quote how much PT_new a given amount of SY buys on the successor market.
 *
 * The buy leg is Exponent's own implied-APY AMM, so the accurate quote comes from the
 * official SDK's pricing — e.g. `@exponent-labs/exponent-sdk`:
 *
 *   const market = await Market.load(env, connection, SUCCESSOR_MARKET);
 *   const ptOut = market.marketCalculator().ptOutForSyIn(syInNative);   // exact-in quote
 *   // or, across orderbook + CLMM + legacy market:
 *   const quote = Router.load(...).getQuote({ direction: BASE_TO_PT, inAmount, syExchangeRate });
 *
 * We return a conservative floor below the quoted amount; `trade_pt` fills exactly this
 * many PT and spends correspondingly less SY (any dust SY stays in the SY account).
 */
async function quotePtOutNative(syInNative: bigint): Promise<bigint> {
  // Placeholder: wire this to the SDK Market/Router as shown above. As a stand-in we
  // assume ~1:1 SY→PT and apply the slippage floor. DO NOT ship this stand-in.
  const quoted = syInNative;
  return (quoted * BigInt(10_000 - BUY_SLIPPAGE_BPS)) / 10_000n;
}

async function main() {
  const connection = getConnection();
  const config = getMarginfiConfig();
  const client = await Project0Client.initialize(connection, config);

  const accountAddress = getAccountAddress(); // e.g. J81jGnkgCBpiY4pnDsretzc4LyTzTpxgeugvi3aJAqvf
  const authority = getWalletPubkey();

  const account = await MarginfiAccount.fetch(accountAddress, client.program);
  const wrapper = new MarginfiAccountWrapper(account, client);

  const maturedBank = client.bankMap.get(MATURED_PT_BANK.toBase58());
  const successorBank = client.bankMap.get(SUCCESSOR_PT_BANK.toBase58());
  if (!maturedBank || !successorBank) {
    throw new Error("PT banks not found in client.bankMap — check MATURED_PT_BANK / SUCCESSOR_PT_BANK");
  }

  const maturedMintData = await wrapper.getMintDataFromBank(maturedBank);
  const successorMintData = await wrapper.getMintDataFromBank(successorBank);

  // --- 1. Matured side: resolve `merge` accounts + redeemed SY ---------------------
  const mergeCtx = await resolveExponentMergeContext({
    connection,
    owner: authority,
    market: MATURED_MARKET,
  });

  // PT position size (UI → native) we are rolling. Here: the whole position.
  const position = account.balances.find((b) => b.bankPk.equals(MATURED_PT_BANK));
  const positionUiAmount = position?.computeQuantityUi(maturedBank).assets.toNumber() ?? 0;
  const ptAmountNative = BigInt(Math.floor(positionUiAmount * 10 ** maturedBank.mintDecimals));
  const redeemedAmountNative = mergeCtx.computeRedeemedAmountNative(ptAmountNative);

  // --- 2. Successor side: resolve `trade_pt` accounts + the market ALT --------------
  const tradeCtx = await resolveExponentTradePtContext({
    connection,
    owner: authority,
    market: SUCCESSOR_MARKET,
  });

  // SY is maturity-independent: the merge's SY account must equal the trade's SY account.
  if (!mergeCtx.mergeAccounts.sySrcDstAta.equals(tradeCtx.tradePtAccounts.tokenSyTrader)) {
    throw new Error("matured vault and successor market do not share an SY mint — cannot roll natively");
  }

  // --- 3. Quote the buy leg ---------------------------------------------------------
  const ptOutNative = await quotePtOutNative(redeemedAmountNative);

  // --- 4. Build the roll ------------------------------------------------------------
  // makeRollPtTx resolves the `merge` internally from `maturedMarket`. Since the buy leg
  // here is the legacy MarketTwo `trade_pt` (not the default `strip`), we pass it via the
  // `buy` escape hatch — analogous to `makeLoopTx`'s `swapEngineRunner` override.
  const { transactions, actionTxIndex } = await wrapper.makeRollPtTx({
    connection,
    assetShareValueMultiplierByBank: new Map(),
    withdrawOpts: {
      totalPositionAmount: positionUiAmount,
      withdrawBank: maturedBank,
      tokenProgram: maturedMintData.tokenProgram,
    },
    depositOpts: {
      depositBank: successorBank,
      tokenProgram: successorMintData.tokenProgram,
    },
    rollOpts: {
      maturedMarket: MATURED_MARKET,
      buy: {
        // a single `trade_pt` (SY → PT_new), spending the merged SY.
        instructions: [
          makeExponentTradePtIx(
            tradeCtx.tradePtAccounts,
            exponentBuyPtArgs({ ptOutNative, maxSyInNative: redeemedAmountNative })
          ),
        ],
        lookupTables: [tradeCtx.addressLookupTable], // the merge vault ALT is added internally
        ptOutNative,
      },
    },
  });

  console.log(`Built roll: ${transactions.length} tx(s), action tx index ${actionTxIndex}`);
  console.log(`  redeemed SY (native): ${redeemedAmountNative}`);
  console.log(`  PT_new bought (native, floor): ${ptOutNative}`);

  // Simulate the action transaction.
  const sim = await connection.simulateTransaction(transactions[actionTxIndex], {
    sigVerify: false,
    replaceRecentBlockhash: true,
  });
  console.log("Simulation logs:", sim.value.logs?.slice(-10));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
