import {
  compileTransaction,
  createNoopSigner,
  fetchAddressesForLookupTables,
  getBase64EncodedWireTransaction,
  getBase64Encoder,
  getTransactionMessageSizeLimit,
  type Address,
  type BlockhashLifetimeConstraint,
  type ReadonlyUint8Array,
  type TransactionSigner,
} from "@solana/kit";
import {
  getSetComputeUnitLimitInstruction,
  getSetComputeUnitPriceInstruction,
} from "@solana-program/compute-budget";
import {
  fetchToken,
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstruction,
} from "@solana-program/token";

import {
  MakeRollPtTxParams,
  RollQuoteSimResult,
  RollQuoteSimulator,
  SwapQuoteResult,
} from "../types";
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

import { MAX_ACCOUNT_LOCKS } from "~/constants";
import { TransactionBuildingError } from "~/errors";
import {
  getTxSize,
  getTotalAccountKeys,
  makeTransactionMessage,
  SolanaTransaction,
  splitInstructionsToFitTransactions,
  TransactionType,
} from "~/services/transaction";
import { uiToNative } from "~/utils";
import {
  EXPONENT_CLMM_PROGRAM_ADDRESS,
  makeExponentClmmTradePtIx,
  makeExponentMergeIx,
  resolveExponentClmmTradePtContext,
  resolveExponentMergeContext,
  SwapDirection,
} from "~/vendor/exponent";

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
  transactions: SolanaTransaction[];
  actionTxIndex: number;
  quoteResponse: SwapQuoteResult | undefined;
}> {
  const { marginfiAccount, authority, rpc, withdrawOpts, depositOpts, rollOpts, luts, version } =
    params;

  // Resolve the matured vault's `merge` (redeem PT → SY) accounts and the successor CLMM pool's
  // `trade_pt` (buy SY → PT) accounts up front. The merge's SY is exactly the CLMM pool's quote
  // token (the same SY mint is shared across maturities), so the redeemed SY feeds the buy directly.
  const { maturedVault, maturedMarket } = rollOpts;
  let mergeTarget: { vault: Address } | { market: Address };
  if (maturedVault) mergeTarget = { vault: maturedVault };
  else if (maturedMarket) mergeTarget = { market: maturedMarket };
  else throw new Error("roll-pt: rollOpts.maturedMarket or maturedVault is required");
  const merge = await resolveExponentMergeContext({
    rpc,
    owner: marginfiAccount.authority,
    ...mergeTarget,
    ptYtTokenProgram: withdrawOpts.tokenProgram,
    syTokenProgram: rollOpts.syTokenProgram,
  });
  const clmm = await resolveExponentClmmTradePtContext({
    rpc,
    owner: marginfiAccount.authority,
    market: rollOpts.successorMarket,
    ptTokenProgram: depositOpts.tokenProgram,
    syTokenProgram: rollOpts.syTokenProgram,
  });

  const { value: latestBlockhash } = await rpc
    .getLatestBlockhash({ commitment: "confirmed" })
    .send();

  // ATAs the bundle touches: old PT (withdraw dest + merge pt_src), the matured vault's YT (a
  // fixed `merge` account — validated as an initialized token account even post-maturity, when no
  // YT is actually moved), the shared SY (merge dst + trade src), and the new PT (trade dest +
  // deposit source). No base, and no YT *byproduct* — the YT ATA just has to exist.
  const setupIxs = await makeSetupIx({
    rpc,
    authority,
    tokens: [
      { mint: withdrawOpts.withdrawBank.mint, tokenProgram: withdrawOpts.tokenProgram },
      { mint: merge.vault.mintYt, tokenProgram: withdrawOpts.tokenProgram },
      { mint: merge.underlying.mint, tokenProgram: merge.underlying.tokenProgram },
      { mint: depositOpts.depositBank.mint, tokenProgram: depositOpts.tokenProgram },
    ],
  });

  const { flashloanTx, swapQuote } = await buildRollPtFlashloanTx({
    params,
    merge,
    clmm,
    latestBlockhash,
  });

  const additionalTxs: SolanaTransaction[] = [];

  if (setupIxs.length > 0) {
    const messages = splitInstructionsToFitTransactions([], setupIxs, {
      latestBlockhash,
      feePayer: authority,
      luts: luts ?? {},
      version,
    });
    additionalTxs.push(
      ...messages.map((message) => ({ message, type: TransactionType.CREATE_ATA }))
    );
  }

  const transactions = [...additionalTxs, flashloanTx];

  return {
    transactions,
    actionTxIndex: transactions.length - 1,
    quoteResponse: swapQuote,
  };
}

type ExponentMergeContext = Awaited<ReturnType<typeof resolveExponentMergeContext>>;
type ExponentClmmTradePtContext = Awaited<ReturnType<typeof resolveExponentClmmTradePtContext>>;

async function buildRollPtFlashloanTx({
  params,
  merge,
  clmm,
  latestBlockhash,
}: {
  params: MakeRollPtTxParams;
  merge: ExponentMergeContext;
  clmm: ExponentClmmTradePtContext;
  latestBlockhash: BlockhashLifetimeConstraint;
}) {
  const {
    programAddress,
    marginfiAccount,
    authority,
    rpc,
    bankMap,
    withdrawOpts,
    depositOpts,
    luts: accountLuts,
    version,
    rollOpts,
  } = params;
  const {
    withdrawBank,
    tokenProgram: withdrawTokenProgram,
    totalPositionAmount,
    withdrawAmount,
  } = withdrawOpts;
  const { depositBank, tokenProgram: depositTokenProgram } = depositOpts;
  const simulateTx = params.simulateTx ?? defaultRollQuoteSimulator(rpc);

  if (withdrawAmount !== undefined && withdrawAmount <= 0) {
    throw new Error("withdrawAmount must be greater than 0");
  }
  const actualWithdrawAmount = Math.min(withdrawAmount ?? totalPositionAmount, totalPositionAmount);
  const isFullWithdraw = isWholePosition(
    { amount: totalPositionAmount, isLending: true },
    actualWithdrawAmount,
    withdrawBank.mintDecimals
  );
  const withdrawNative = uiToNative(actualWithdrawAmount, withdrawBank.mintDecimals);

  const cuRequestIxs = [
    getSetComputeUnitLimitInstruction({ units: 1_200_000 }),
    getSetComputeUnitPriceInstruction({ microLamports: 1 }),
  ];

  // 1. Withdraw the matured PT (standard SPL collateral bank).
  const withdrawIxs = await makeWithdrawIx({
    programAddress,
    bank: withdrawBank,
    bankMap,
    tokenProgram: withdrawTokenProgram,
    amount: actualWithdrawAmount,
    marginfiAccount,
    authority,
    withdrawAll: isFullWithdraw,
    opts: { createAtas: false, wrapAndUnwrapSol: false },
  });

  // 2. `merge`: PT_old → SY, post-maturity (1:1, no AMM). The redeemed SY is exactly the CLMM
  //    pool's quote token, so it feeds the buy directly.
  const mergeIx = await makeExponentMergeIx(
    { ...merge.mergeInput, owner: authority, amount: withdrawNative },
    merge.remainingAccounts
  );

  // 3. Deposit the new PT — seeded with a placeholder, byte-patched to the swap's min output.
  const depositIxs = await makeDepositIx({
    programAddress,
    bank: depositBank,
    tokenProgram: depositTokenProgram,
    amount: 0,
    marginfiAccount,
    authority,
    opts: { wrapAndUnwrapSol: false },
  });

  // LUTs for the bundle: the matured vault ALT (merge remaining accounts) + the CLMM pool ALT
  // (trade_pt remaining accounts). A dedicated PT-roll LUT (`rollOpts.lookupTable`) can replace
  // them to compress bytes; account *locks* are bounded by the fixed, compact CLMM footprint.
  const exponentLuts = {
    [merge.lookupTable.address]: merge.lookupTable.addresses,
    [clmm.lookupTable.address]: clmm.lookupTable.addresses,
  };
  const luts = rollOpts.lookupTable
    ? {
        ...(await fetchAddressesForLookupTables([rollOpts.lookupTable], rpc)),
        ...exponentLuts,
      }
    : { ...accountLuts, ...exponentLuts };

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
    rpc,
    simulateTx,
    clmm,
    amountInSyNative: syExact,
    payer: authority,
    latestBlockhash,
  });

  const slippageBps = rollOpts.slippageBps ?? DEFAULT_ROLL_SLIPPAGE_BPS;
  // Guaranteed floor: the trade reverts below this, and the deposit is sized to it so it can
  // never exceed the PT actually received (any slippage dust stays in the wallet).
  const minPtOut = (exactPtOut * BigInt(10_000 - slippageBps)) / 10_000n;
  if (minPtOut <= 0n) {
    throw new Error("roll-pt: quoted PT out is 0 (insufficient CLMM liquidity for this size)");
  }

  // 5. Buy the new PT with the redeemed SY (exact-in on the merge's SY, min-out guard on PT).
  const tradeIx = await makeExponentClmmTradePtIx(
    {
      ...clmm.tradePtInput,
      trader: authority,
      amountIn: syExact,
      swapDirection: SwapDirection.SyToPt,
      amountOutConstraint: minPtOut,
      priceSpotLimit: null,
    },
    clmm.remainingAccounts
  );

  // Patch the seeded deposit to the guaranteed (minimum) PT output.
  const depositIxIndex = depositIxs.findIndex(isDepositIx);
  if (depositIxIndex < 0) {
    throw new Error("roll-pt: could not locate deposit instruction for amount patching");
  }
  depositIxs[depositIxIndex] = patchDepositAmount(depositIxs[depositIxIndex], minPtOut);

  const allNonFlIxs = [...cuRequestIxs, ...withdrawIxs, mergeIx, tradeIx, ...depositIxs];

  // Size the precheck against the full footprint (the CLMM swap is part of the flashloan, not an
  // engine route, so there are no separate swap ix/LUT counts to reserve).
  const { sizeConstraint } = await computeFlashLoanNonSwapBudget({
    programAddress,
    marginfiAccount,
    bankMap,
    addressLookupTableAccounts: luts,
    ixs: allNonFlIxs,
  });

  compileFlashloanPrecheck({
    allIxs: allNonFlIxs,
    payer: authority.address,
    luts,
    sizeConstraint,
    swapIxCount: 0,
    swapLutCount: 0,
    version,
  });

  const flashloanTx = await makeFlashLoanTx({
    programAddress,
    marginfiAccount,
    authority,
    bankMap,
    luts,
    version,
    latestBlockhash,
    ixs: allNonFlIxs,
  });

  const txSize = getTxSize(flashloanTx.message);
  const totalKeys = getTotalAccountKeys(flashloanTx.message);
  if (
    txSize > getTransactionMessageSizeLimit(flashloanTx.message) ||
    totalKeys > MAX_ACCOUNT_LOCKS
  ) {
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

/** The default {@link RollQuoteSimulator}: a plain `rpc.simulateTransaction`. */
function defaultRollQuoteSimulator(rpc: MakeRollPtTxParams["rpc"]): RollQuoteSimulator {
  return async (tx) => {
    const { value } = await rpc
      .simulateTransaction(getBase64EncodedWireTransaction(tx), {
        encoding: "base64",
        sigVerify: false,
        replaceRecentBlockhash: true,
      })
      .send();
    return { err: value.err, logs: value.logs, returnData: value.returnData };
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
function readTradePtOut(data: ReadonlyUint8Array, amountIn: bigint): bigint | null {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (data.length === 16) {
    const a = view.getBigUint64(0, true);
    const b = view.getBigUint64(8, true);
    if (a === amountIn) return b;
    if (b === amountIn) return a;
    return null;
  }
  if (data.length >= TRADE_PT_EVENT_AMOUNT_OUT_OFFSET + 8) {
    return view.getBigUint64(TRADE_PT_EVENT_AMOUNT_OUT_OFFSET, true);
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
  rpc,
  simulateTx,
  clmm,
  amountInSyNative,
  payer,
  latestBlockhash,
}: {
  rpc: MakeRollPtTxParams["rpc"];
  simulateTx: RollQuoteSimulator;
  clmm: ExponentClmmTradePtContext;
  amountInSyNative: bigint;
  payer: TransactionSigner;
  latestBlockhash: BlockhashLifetimeConstraint;
}): Promise<bigint> {
  // Exclude the pool's own SY token accounts so we don't quote against its escrow/treasury.
  const excluded = new Set([clmm.tradePtInput.tokenSyEscrow, clmm.tradePtInput.tokenFeeTreasurySy]);
  const largest = await rpc.getTokenLargestAccounts(clmm.sy.mint).send();
  const funded = largest.value.find(
    (a) => !excluded.has(a.address) && BigInt(a.amount) >= amountInSyNative
  );
  if (!funded) {
    throw new Error(
      "roll-pt: no SY holder large enough to quote the buy — the roll size exceeds available " +
        "CLMM liquidity for this pair"
    );
  }
  const { data: holder } = await fetchToken(rpc, funded.address);
  const trader = holder.owner;
  const [tokenPtTrader] = await findAssociatedTokenPda({
    mint: clmm.pt.mint,
    owner: trader,
    tokenProgram: clmm.pt.tokenProgram,
  });

  // Re-point the trade at the funded holder (the pool/ticks/escrow/CPI accounts are unchanged).
  const quoteIx = await makeExponentClmmTradePtIx(
    {
      ...clmm.tradePtInput,
      trader: createNoopSigner(trader),
      tokenSyTrader: funded.address,
      tokenPtTrader,
      amountIn: amountInSyNative,
      swapDirection: SwapDirection.SyToPt,
      amountOutConstraint: 1n,
      priceSpotLimit: null,
    },
    clmm.remainingAccounts
  );
  const createPtAta = getCreateAssociatedTokenIdempotentInstruction({
    payer,
    ata: tokenPtTrader,
    owner: trader,
    mint: clmm.pt.mint,
    tokenProgram: clmm.pt.tokenProgram,
  });

  const message = makeTransactionMessage({
    instructions: [createPtAta, quoteIx],
    feePayer: payer,
    latestBlockhash,
    luts: { [clmm.lookupTable.address]: clmm.lookupTable.addresses },
  });
  const sim = await simulateTx(compileTransaction(message));

  if (process.env.ROLL_DEBUG) {
    // eslint-disable-next-line no-console
    console.error(
      "[roll trade quote] err:",
      JSON.stringify(sim.err),
      "returnData?",
      !!sim.returnData
    );
  }

  // The PT actually credited to the trader IS the quote — transport-independent ground
  // truth, reported by bundle-sim transports. The trade is the trader's only PT movement.
  const delta = tokenBalanceDelta(sim, clmm.pt.mint, trader);
  if (delta !== null && delta > 0n) return delta;

  // Plain `simulateTransaction` transports report no token balances — read the program
  // return blob instead.
  const rd = sim.returnData;
  if (rd?.data && rd.programId === EXPONENT_CLMM_PROGRAM_ADDRESS) {
    const out = readTradePtOut(getBase64Encoder().encode(rd.data[0]), amountInSyNative);
    if (out !== null && out > 0n) return out;
  }

  throw new Error(
    `roll-pt: CLMM trade quote produced no readable output (err=${JSON.stringify(sim.err)})`
  );
}
