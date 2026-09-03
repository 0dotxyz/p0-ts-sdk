import { Buffer } from "buffer";

import {
  AddressLookupTableAccount,
  ComputeBudgetProgram,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import BN from "bn.js";


import { MakeRollPtTxParams, RollQuoteSimResult, RollQuoteSimulator, SwapQuoteResult } from "../types";
import {
  isWholePosition,
  computeFlashLoanNonSwapBudget,
  compileFlashloanPrecheck,
  patchDepositAmount,
  isDepositIx,
} from "../utils";

import { makeSetupIx } from "./account-lifecycle";
import { makeDepositIx } from "./deposit";
import { makeFlashLoanTx } from "./flash-loan";
import { makeWithdrawIx } from "./withdraw";

import { MAX_TX_SIZE, MAX_ACCOUNT_LOCKS } from "~/constants";
import { TransactionBuildingError } from "~/errors";
import { makeSmartCrankSwbFeedIx } from "~/services/price";
import {
  addTransactionMetadata,
  ExtendedV0Transaction,
  getTxSize,
  getTotalAccountKeys,
  InstructionsWrapper,
  splitInstructionsToFitTransactions,
  TransactionType,
} from "~/services/transaction";
import { uiToNative } from "~/utils";
import {
  EXPONENT_CLMM_PROGRAM_ID,
  ExponentClmmTradePtContext,
  ExponentMergeContext,
  exponentClmmBuyPtArgs,
  makeExponentClmmTradePtIx,
  makeExponentMergeIx,
  resolveExponentClmmTradePtContext,
  resolveExponentMergeContext,
} from "~/vendor/exponent";
import {
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
} from "~/vendor/spl";

/** Default slippage tolerance (bps) for the SY → PT CLMM swap when the caller omits one. */
const DEFAULT_ROLL_SLIPPAGE_BPS = 50;

/**
 * Byte offset of `amount_out` (u64 LE) in a CLMM `trade_pt` `TradePtEvent` return blob:
 * 4 pubkeys (128) + swap_direction(u8) + is_current_flash_swap(bool) + amount_in(u64) = 138.
 */
const TRADE_PT_EVENT_AMOUNT_OUT_OFFSET = 138;

/**
 * Roll a matured Exponent PT collateral position into its next-maturity PT, so the **full
 * deposit ends up as new PT** (no leftover), in one flash-loan-wrapped bundle:
 *
 *   withdraw PT_old → Exponent `merge` (PT_old → SY) → CLMM `trade_pt` (SY → PT_new)
 *     → deposit PT_new
 *
 * The matured PT is redeemed 1:1 to its SY, then the successor PT is bought **directly on its
 * CLMM (`MarketThree`) PT/SY pool** — no base-token round-trip and no external aggregator. The
 * newer maturities (e.g. October bulkSOL) only list a CLMM pool (no `MarketTwo`, no order
 * book), and the CLMM uses a single `ticks` account, so the swap is a fixed, compact account
 * set regardless of trade size. The caller passes the matured Exponent market/vault + the
 * successor CLMM pool (`rollOpts`); everything Exponent is resolved internally. The buy is
 * bounded by the pool's depth.
 */
export async function makeRollPtTx(params: MakeRollPtTxParams): Promise<{
  transactions: ExtendedV0Transaction[];
  actionTxIndex: number;
  quoteResponse: SwapQuoteResult | undefined;
}> {
  const {
    program,
    marginfiAccount,
    connection,
    bankMap,
    oraclePrices,
    withdrawOpts,
    depositOpts,
    rollOpts,
    assetShareValueMultiplierByBank,
    addressLookupTableAccounts,
    crossbarUrl,
  } = params;

  if (!rollOpts.maturedMarket && !rollOpts.maturedVault) {
    throw new Error("roll-pt: rollOpts.maturedMarket or maturedVault is required");
  }

  // Resolve the matured vault's `merge` (redeem PT → SY) accounts and the successor CLMM pool's
  // `trade_pt` (buy SY → PT) accounts up front. The merge's SY is exactly the CLMM pool's quote
  // token (the same SY mint is shared across maturities), so the redeemed SY feeds the buy directly.
  const merge = await resolveExponentMergeContext({
    connection,
    owner: marginfiAccount.authority,
    market: rollOpts.maturedMarket,
    vault: rollOpts.maturedVault,
    ptYtTokenProgram: withdrawOpts.tokenProgram,
    syTokenProgram: rollOpts.syTokenProgram,
  });
  const clmm = await resolveExponentClmmTradePtContext({
    connection,
    owner: marginfiAccount.authority,
    market: rollOpts.successorMarket,
    ptTokenProgram: depositOpts.tokenProgram,
    syTokenProgram: rollOpts.syTokenProgram,
  });

  const blockhash = (await connection.getLatestBlockhash("confirmed")).blockhash;

  // ATAs the bundle touches: old PT (withdraw dest + merge pt_src), the matured vault's YT (a
  // fixed `merge` account — validated as an initialized token account even post-maturity, when no
  // YT is actually moved), the shared SY (merge dst + trade src), and the new PT (trade dest +
  // deposit source). No base, and no YT *byproduct* — the YT ATA just has to exist.
  const setupIxs = await makeSetupIx({
    connection,
    authority: marginfiAccount.authority,
    tokens: [
      { mint: withdrawOpts.withdrawBank.mint, tokenProgram: withdrawOpts.tokenProgram },
      { mint: merge.mergeAccounts.mintYt, tokenProgram: withdrawOpts.tokenProgram },
      { mint: merge.underlying.mint, tokenProgram: merge.underlying.tokenProgram },
      { mint: depositOpts.depositBank.mint, tokenProgram: depositOpts.tokenProgram },
    ],
  });

  const { flashloanTx, swapQuote, withdrawIxs, depositIxs } = await buildRollPtFlashloanTx({
    params,
    merge,
    clmm,
    setupIxs,
    blockhash,
  });

  const { instructions: updateFeedIxs, luts: feedLuts } = await makeSmartCrankSwbFeedIx({
    marginfiAccount,
    bankMap,
    oraclePrices,
    assetShareValueMultiplierByBank,
    instructions: [...withdrawIxs.instructions, ...depositIxs.instructions],
    program,
    connection,
    crossbarUrl,
  });

  const additionalTxs: ExtendedV0Transaction[] = [];

  if (setupIxs.length > 0) {
    const txs = splitInstructionsToFitTransactions([], setupIxs, {
      blockhash,
      payerKey: marginfiAccount.authority,
      luts: addressLookupTableAccounts ?? [],
    });
    additionalTxs.push(
      ...txs.map((tx) =>
        addTransactionMetadata(tx, {
          type: TransactionType.CREATE_ATA,
          addressLookupTables: addressLookupTableAccounts,
        })
      )
    );
  }

  if (updateFeedIxs.length > 0) {
    const message = new TransactionMessage({
      payerKey: marginfiAccount.authority,
      recentBlockhash: blockhash,
      instructions: updateFeedIxs,
    }).compileToV0Message(feedLuts);
    additionalTxs.push(
      addTransactionMetadata(new VersionedTransaction(message), {
        addressLookupTables: feedLuts,
        type: TransactionType.CRANK,
      })
    );
  }

  const transactions = [...additionalTxs, flashloanTx];

  return {
    transactions,
    actionTxIndex: transactions.length - 1,
    quoteResponse: swapQuote,
  };
}

async function buildRollPtFlashloanTx({
  params,
  merge,
  clmm,
  setupIxs,
  blockhash,
}: {
  params: MakeRollPtTxParams;
  merge: ExponentMergeContext;
  clmm: ExponentClmmTradePtContext;
  setupIxs: TransactionInstruction[];
  blockhash: string;
}) {
  const {
    program,
    marginfiAccount,
    bankMap,
    withdrawOpts,
    depositOpts,
    bankMetadataMap,
    connection,
    addressLookupTableAccounts,
    overrideInferAccounts,
    rollOpts,
  } = params;
  const { withdrawBank, tokenProgram: withdrawTokenProgram, totalPositionAmount, withdrawAmount } =
    withdrawOpts;
  const { depositBank, tokenProgram: depositTokenProgram } = depositOpts;
  const authority = marginfiAccount.authority;
  const simulateTx = params.simulateTx ?? defaultRollQuoteSimulator(connection);

  if (withdrawAmount !== undefined && withdrawAmount <= 0) {
    throw new Error("withdrawAmount must be greater than 0");
  }
  const actualWithdrawAmount = Math.min(withdrawAmount ?? totalPositionAmount, totalPositionAmount);
  const isFullWithdraw = isWholePosition(
    { amount: totalPositionAmount, isLending: true },
    actualWithdrawAmount,
    withdrawBank.mintDecimals
  );
  const withdrawNative = BigInt(
    uiToNative(actualWithdrawAmount, withdrawBank.mintDecimals).toString()
  );

  const cuRequestIxs = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: 1_200_000 }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1 }),
  ];

  // 1. Withdraw the matured PT (standard SPL collateral bank).
  const withdrawIxs: InstructionsWrapper = await makeWithdrawIx({
    program,
    bank: withdrawBank,
    bankMap,
    tokenProgram: withdrawTokenProgram,
    amount: actualWithdrawAmount,
    marginfiAccount,
    authority,
    withdrawAll: isFullWithdraw,
    bankMetadataMap,
    isSync: false,
    opts: { createAtas: false, wrapAndUnwrapSol: false, overrideInferAccounts },
  });

  // 2. `merge`: PT_old → SY, post-maturity (1:1, no AMM). The redeemed SY is exactly the CLMM
  //    pool's quote token, so it feeds the buy directly.
  const mergeIx = makeExponentMergeIx(merge.mergeAccounts, withdrawNative);

  // 3. Deposit the new PT — seeded with a placeholder, byte-patched to the swap's min output.
  const depositIxs: InstructionsWrapper = await makeDepositIx({
    program,
    bank: depositBank,
    tokenProgram: depositTokenProgram,
    amount: 0,
    accountAddress: marginfiAccount.address,
    authority,
    group: marginfiAccount.group,
    opts: { wrapAndUnwrapSol: false, overrideInferAccounts },
  });

  // LUTs for the bundle: the matured vault ALT (merge remaining accounts) + the CLMM pool ALT
  // (trade_pt remaining accounts). A dedicated PT-roll LUT (`rollOpts.lookupTable`) can replace
  // them to compress bytes; account *locks* are bounded by the fixed, compact CLMM footprint.
  let luts: AddressLookupTableAccount[];
  if (rollOpts.lookupTable) {
    const fetched = (await connection.getAddressLookupTable(rollOpts.lookupTable)).value;
    if (!fetched) {
      throw new Error(`roll-pt: PT-roll lookup table not found: ${rollOpts.lookupTable.toBase58()}`);
    }
    luts = [fetched, merge.addressLookupTable, clmm.addressLookupTable];
  } else {
    luts = [
      ...(addressLookupTableAccounts ?? []),
      merge.addressLookupTable,
      clmm.addressLookupTable,
    ];
  }

  // 4. Size the redeem deterministically: merge pays floor(pt × sy_for_pt / pt_supply) —
  //    Exponent's `Vault::pt_redemption_rate` — computed from the vault state fetched at
  //    resolve time, so it matches the program's own floor math exactly. (Reading
  //    `MergeEvent.amount_sy_out` from a flash-loan quote sim is not viable in practice:
  //    the withdraw's event logs blow the node's log budget, truncating the return line,
  //    and bundle-sim transports return no structured `returnData`.)
  const syExact = merge.computeRedeemedAmountNative(withdrawNative);
  if (syExact <= 0n) {
    throw new Error("roll-pt: merge would redeem 0 SY (empty/invalid matured vault state)");
  }

  const exactPtOut = await quoteClmmTradeOut({
    connection,
    simulateTx,
    clmm,
    amountInSyNative: syExact,
    payer: authority,
  });

  const slippageBps = rollOpts.slippageBps ?? DEFAULT_ROLL_SLIPPAGE_BPS;
  // Guaranteed floor: the trade reverts below this, and the deposit is sized to it so it can
  // never exceed the PT actually received (any slippage dust stays in the wallet).
  const minPtOut = (exactPtOut * BigInt(10_000 - slippageBps)) / 10_000n;
  if (minPtOut <= 0n) {
    throw new Error("roll-pt: quoted PT out is 0 (insufficient CLMM liquidity for this size)");
  }

  // 5. Buy the new PT with the redeemed SY (exact-in on the merge's SY, min-out guard on PT).
  const tradeIx = makeExponentClmmTradePtIx(
    clmm.tradePtAccounts,
    exponentClmmBuyPtArgs({ amountInSyNative: syExact, minPtOutNative: minPtOut })
  );

  // Patch the seeded deposit to the guaranteed (minimum) PT output.
  const depositIxToPatch = depositIxs.instructions.find(isDepositIx);
  if (!depositIxToPatch) {
    throw new Error("roll-pt: could not locate deposit instruction for amount patching");
  }
  patchDepositAmount(depositIxToPatch, new BN(minPtOut.toString()));

  const allNonFlIxs = [
    ...cuRequestIxs,
    ...withdrawIxs.instructions,
    mergeIx,
    tradeIx,
    ...depositIxs.instructions,
  ];

  // Size the precheck against the full footprint (the CLMM swap is part of the flashloan, not an
  // engine route, so there are no separate swap ix/LUT counts to reserve).
  const { sizeConstraint } = computeFlashLoanNonSwapBudget({
    program,
    marginfiAccount,
    bankMap,
    addressLookupTableAccounts: luts,
    ixs: allNonFlIxs,
  });

  compileFlashloanPrecheck({
    allIxs: allNonFlIxs,
    payer: authority,
    luts,
    sizeConstraint,
    swapIxCount: 0,
    swapLutCount: 0,
  });

  const flashloanTx = await makeFlashLoanTx({
    program,
    marginfiAccount,
    bankMap,
    addressLookupTableAccounts: luts,
    blockhash,
    ixs: allNonFlIxs,
    isSync: false,
  });

  const txSize = getTxSize(flashloanTx);
  const totalKeys = getTotalAccountKeys(flashloanTx);
  if (txSize > MAX_TX_SIZE || totalKeys > MAX_ACCOUNT_LOCKS) {
    throw TransactionBuildingError.swapSizeExceededPositionSwap(txSize, totalKeys, undefined);
  }

  const swapQuote: SwapQuoteResult = {
    inAmount: syExact.toString(),
    outAmount: exactPtOut.toString(),
    otherAmountThreshold: minPtOut.toString(),
    slippageBps,
  };

  return { flashloanTx, swapQuote, withdrawIxs, depositIxs };
}

/** The default {@link RollQuoteSimulator}: a plain `connection.simulateTransaction`. */
function defaultRollQuoteSimulator(
  connection: MakeRollPtTxParams["connection"]
): RollQuoteSimulator {
  return async (tx) => {
    const sim = await connection.simulateTransaction(tx, {
      sigVerify: false,
      replaceRecentBlockhash: true,
    });
    return {
      err: sim.value.err,
      logs: sim.value.logs,
      returnData: (sim.value as { returnData?: RollQuoteSimResult["returnData"] }).returnData,
    };
  };
}

/**
 * Net native-amount change of (`mint`, `owner`) across a quote sim's token balances, or
 * `null` when the transport supplied none (plain `simulateTransaction` doesn't).
 */
function tokenBalanceDelta(sim: RollQuoteSimResult, mint: string, owner: string): bigint | null {
  if (!sim.preTokenBalances && !sim.postTokenBalances) return null;
  const sum = (list: RollQuoteSimResult["postTokenBalances"]) =>
    (list ?? [])
      .filter((b) => b.mint === mint && b.owner === owner)
      .reduce((acc, b) => acc + BigInt(b.amount), 0n);
  return sum(sim.postTokenBalances) - sum(sim.preTokenBalances);
}

/**
 * Read `amount_out` from a `trade_pt` return blob. The committed IDL declares the full
 * `TradePtEvent` (amount_out at byte 138), but the DEPLOYED program returns a compact
 * 16-byte pair — decoded self-validatingly: the field equal to the known `amountIn`
 * identifies the layout, the other field is `amount_out`. Returns `null` when the blob
 * matches neither shape.
 */
function readTradePtOut(data: Buffer, amountIn: bigint): bigint | null {
  if (data.length === 16) {
    const a = data.readBigUInt64LE(0);
    const b = data.readBigUInt64LE(8);
    if (a === amountIn) return b;
    if (b === amountIn) return a;
    return null;
  }
  if (data.length >= TRADE_PT_EVENT_AMOUNT_OUT_OFFSET + 8) {
    return data.readBigUInt64LE(TRADE_PT_EVENT_AMOUNT_OUT_OFFSET);
  }
  return null;
}

/**
 * Quote the exact PT out for `amountInSyNative` SY on the successor CLMM, by simulating a
 * **standalone** `trade_pt` and reading the trader's PT balance delta (or the program
 * return blob when the transport reports no token balances).
 *
 * A CLMM swap is trader-independent — the output for a given input + pool state is the same
 * whoever trades — so we run the quote against an existing large SY holder (the swap isn't
 * executed; the holder's balance just lets the simulation transfer `amountInSyNative` SY). This
 * keeps the quote a short, self-contained, **succeeding** simulation: its `returnData` is
 * reliable (unlike the redeem+trade flash-loan sim, whose logs can truncate). The roll authority
 * is the fee payer (`sigVerify` is off, so neither it nor the holder needs to actually sign).
 */
async function quoteClmmTradeOut({
  connection,
  simulateTx,
  clmm,
  amountInSyNative,
  payer,
}: {
  connection: MakeRollPtTxParams["connection"];
  simulateTx: RollQuoteSimulator;
  clmm: ExponentClmmTradePtContext;
  amountInSyNative: bigint;
  payer: PublicKey;
}): Promise<bigint> {
  // Exclude the pool's own SY token accounts so we don't quote against its escrow/treasury.
  const excluded = new Set([
    clmm.tradePtAccounts.tokenSyEscrow.toBase58(),
    clmm.tradePtAccounts.tokenFeeTreasurySy.toBase58(),
  ]);
  const largest = await connection.getTokenLargestAccounts(clmm.sy.mint);
  const funded = largest.value.find(
    (a) => !excluded.has(a.address.toBase58()) && BigInt(a.amount) >= amountInSyNative
  );
  if (!funded) {
    throw new Error(
      "roll-pt: no SY holder large enough to quote the buy — the roll size exceeds available " +
        "CLMM liquidity for this pair"
    );
  }
  const parsed = await connection.getParsedAccountInfo(funded.address);
  const info = (parsed.value?.data as { parsed?: { info?: { owner?: string } } } | undefined)?.parsed
    ?.info;
  if (!info?.owner) throw new Error("roll-pt: could not resolve the quote SY holder's owner");
  const trader = new PublicKey(info.owner);
  const ptTokenProgram = clmm.pt.tokenProgram ?? TOKEN_PROGRAM_ID;
  const tokenPtTrader = getAssociatedTokenAddressSync(clmm.pt.mint, trader, true, ptTokenProgram);

  // Re-point the trade at the funded holder (the pool/ticks/escrow/CPI accounts are unchanged).
  const quoteIx = makeExponentClmmTradePtIx(
    { ...clmm.tradePtAccounts, trader, tokenSyTrader: funded.address, tokenPtTrader },
    exponentClmmBuyPtArgs({ amountInSyNative, minPtOutNative: 1n })
  );
  const createPtAta = createAssociatedTokenAccountIdempotentInstruction(
    payer,
    tokenPtTrader,
    trader,
    clmm.pt.mint,
    ptTokenProgram
  );

  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  const message = new TransactionMessage({
    payerKey: payer,
    recentBlockhash: blockhash,
    instructions: [createPtAta, quoteIx],
  }).compileToV0Message([clmm.addressLookupTable]);
  const sim = await simulateTx(new VersionedTransaction(message));

  if (process.env.ROLL_DEBUG) {
    // eslint-disable-next-line no-console
    console.error("[roll trade quote] err:", JSON.stringify(sim.err), "returnData?", !!sim.returnData);
  }

  // The PT actually credited to the trader IS the quote — transport-independent ground
  // truth, reported by bundle-sim transports. The trade is the trader's only PT movement.
  const delta = tokenBalanceDelta(sim, clmm.pt.mint.toBase58(), trader.toBase58());
  if (delta !== null && delta > 0n) return delta;

  // Plain `simulateTransaction` transports report no token balances — read the program
  // return blob instead.
  const rd = sim.returnData;
  if (rd?.data && rd.programId === EXPONENT_CLMM_PROGRAM_ID.toBase58()) {
    const out = readTradePtOut(Buffer.from(rd.data[0], rd.data[1] as BufferEncoding), amountInSyNative);
    if (out !== null && out > 0n) return out;
  }

  throw new Error(
    `roll-pt: CLMM trade quote produced no readable output (err=${JSON.stringify(sim.err)})`
  );
}
