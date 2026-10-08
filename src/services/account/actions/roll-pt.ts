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
  SwapFlowTxResult,
  SwapQuoteResult,
} from "../types";
import {
  isWholePosition,
  computeFlashLoanNonSwapBudget,
  compileFlashloanPrecheck,
  patchDepositAmount,
} from "../utils";

import { makeCreateMissingAtaIxs } from "./account-lifecycle";
import { makeDepositIx } from "./deposit";
import { makeFlashLoanTx } from "./flash-loan";
import { makeWithdrawIx } from "./withdraw";

import { MAX_ACCOUNT_LOCKS } from "~/constants";
import { TransactionBuildingError } from "~/errors";
import { makeRefreshIntegrationBanksIxs } from "~/services/price";
import {
  getTxSize,
  getTotalAccountKeys,
  makePreludeTxs,
  makeTransactionMessage,
  SolanaTransaction,
  TransactionFormat,
  withLookupTables,
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
 * Rolls a matured Exponent PT position into its successor maturity in one flashloan: withdraws the
 * matured PT, redeems it 1:1 to SY (`merge`), buys the successor PT with that SY on its CLMM pool
 * (`rollOpts.successorMarket`) and deposits it, so the whole position ends up as the new PT. The
 * deposit is the trade's guaranteed minimum; anything above it stays in the wallet.
 * @throws TransactionBuildingError (ROLL_PT_INVALID) if `rollOpts` names neither the matured
 * market nor vault, or the matured vault would redeem no SY
 * @throws TransactionBuildingError (INVALID_AMOUNT) if `withdrawAmount` isn't positive
 * @throws TransactionBuildingError (SWAP_QUOTE_FAILED) if the CLMM pool can't quote the buy, e.g.
 * too little liquidity for the size
 * @throws TransactionBuildingError (SWAP_SIZE_EXCEEDED_POSITION_SWAP) if the flashloan doesn't fit
 * one transaction
 */
export async function makeRollPtTx(params: MakeRollPtTxParams): Promise<SwapFlowTxResult> {
  const {
    marginfiAccount,
    authority,
    rpc,
    bankMap,
    bankMetadataMap,
    withdrawOpts,
    depositOpts,
    rollOpts,
    txFormat,
  } = params;

  // The merge's SY is the CLMM pool's quote token (one SY mint across maturities), so the
  // redeemed SY feeds the buy directly
  const { maturedVault, maturedMarket } = rollOpts;
  let mergeTarget: { vault: Address } | { market: Address };
  if (maturedVault) mergeTarget = { vault: maturedVault };
  else if (maturedMarket) mergeTarget = { market: maturedMarket };
  else throw TransactionBuildingError.rollPtInvalid("rollOpts needs maturedMarket or maturedVault");
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
  const setupIxs = await makeCreateMissingAtaIxs({
    rpc,
    authority,
    tokens: [
      { mint: withdrawOpts.withdrawBank.mint, tokenProgram: withdrawOpts.tokenProgram },
      { mint: merge.vault.mintYt, tokenProgram: withdrawOpts.tokenProgram },
      { mint: merge.underlying.mint, tokenProgram: merge.underlying.tokenProgram },
      { mint: depositOpts.depositBank.mint, tokenProgram: depositOpts.tokenProgram },
    ],
  });

  // end_flashloan prices every collateral leg, and with premium-bearing debt an unpriceable
  // (stale) Kamino/Drift/JupLend leg reverts it (6615), so every integration bank is refreshed.
  const refreshIntegrationIxs = await makeRefreshIntegrationBanksIxs(
    marginfiAccount,
    bankMap,
    [withdrawOpts.withdrawBank.address, depositOpts.depositBank.address],
    bankMetadataMap
  );

  const { flashloanTx, swapQuote } = await buildRollPtFlashloanTx({
    params,
    merge,
    clmm,
    latestBlockhash,
  });

  const additionalTxs = makePreludeTxs(setupIxs, refreshIntegrationIxs, {
    latestBlockhash,
    feePayer: authority,
    txFormat,
  });

  const transactions = [...additionalTxs, flashloanTx];

  return {
    transactions,
    actionTxIndex: transactions.length - 1,
    quoteResponse: swapQuote,
    mustBeAtomicBundle: refreshIntegrationIxs.length > 0,
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
}): Promise<{ flashloanTx: SolanaTransaction; swapQuote: SwapQuoteResult }> {
  const {
    programAddress,
    marginfiAccount,
    authority,
    rpc,
    bankMap,
    withdrawOpts,
    depositOpts,
    txFormat: accountFormat,
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
    throw TransactionBuildingError.invalidAmount(withdrawAmount);
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

  const withdrawIxs = await makeWithdrawIx({
    programAddress,
    bank: withdrawBank,
    bankMap,
    tokenProgram: withdrawTokenProgram,
    amount: actualWithdrawAmount,
    marginfiAccount,
    authority,
    withdrawAll: isFullWithdraw,
    opts: { createAta: false, unwrapSol: false },
  });

  const mergeIx = await makeExponentMergeIx(
    { ...merge.mergeInput, owner: authority, amount: withdrawNative },
    merge.remainingAccounts
  );

  // Seeded with 0 and patched to the trade's guaranteed output below
  const depositIxs = await makeDepositIx({
    programAddress,
    bank: depositBank,
    tokenProgram: depositTokenProgram,
    amount: 0,
    marginfiAccount,
    authority,
    opts: { wrapSol: false },
  });

  // LUTs for a v0 bundle: the matured vault ALT (merge remaining accounts) + the CLMM pool ALT
  // (trade_pt remaining accounts). A dedicated PT-roll LUT (`rollOpts.lookupTable`) can replace
  // them to compress bytes; account *locks* are bounded by the fixed, compact CLMM footprint.
  const exponentLuts = {
    [merge.lookupTable.address]: merge.lookupTable.addresses,
    [clmm.lookupTable.address]: clmm.lookupTable.addresses,
  };
  const txFormat: TransactionFormat =
    rollOpts.lookupTable && accountFormat.version === 0
      ? {
          version: 0,
          luts: {
            ...(await fetchAddressesForLookupTables([rollOpts.lookupTable], rpc)),
            ...exponentLuts,
          },
        }
      : withLookupTables(accountFormat, exponentLuts);

  // Merge pays floor(pt × sy_for_pt / pt_supply) (Exponent's `Vault::pt_redemption_rate`), computed
  // from the fetched vault state to match the program exactly. Reading `MergeEvent.amount_sy_out`
  // from a simulation doesn't work: the withdraw's logs truncate the return line, and bundle-sim
  // transports return no `returnData`.
  const syExact = merge.computeRedeemedAmountNative(withdrawNative);
  if (syExact <= 0n) {
    throw TransactionBuildingError.rollPtInvalid("the matured vault would redeem 0 SY");
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
    throw TransactionBuildingError.swapQuoteFailed(
      "exponent",
      clmm.sy.mint,
      clmm.pt.mint,
      "quoted PT out is 0: too little CLMM liquidity for this size"
    );
  }

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

  // Without wSOL wrapping the deposit is a single instruction
  const depositIx = patchDepositAmount(depositIxs[0], minPtOut);

  const allNonFlIxs = [...cuRequestIxs, ...withdrawIxs, mergeIx, tradeIx, depositIx];

  // Size the precheck against the full footprint (the CLMM swap is part of the flashloan, not an
  // engine route, so there are no separate swap ix/LUT counts to reserve).
  const { sizeConstraint } = await computeFlashLoanNonSwapBudget({
    programAddress,
    marginfiAccount,
    bankMap,
    txFormat,
    ixs: allNonFlIxs,
  });

  compileFlashloanPrecheck({
    allIxs: allNonFlIxs,
    payer: authority.address,
    txFormat,
    sizeConstraint,
    swapIxCount: 0,
    swapLutCount: 0,
  });

  const flashloanTx = await makeFlashLoanTx({
    programAddress,
    marginfiAccount,
    authority,
    bankMap,
    txFormat,
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

  return { flashloanTx, swapQuote };
}

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

// null when the transport reports no token balances (plain `simulateTransaction` doesn't)
function tokenBalanceDelta(sim: RollQuoteSimResult, mint: string, owner: string): bigint | null {
  if (!sim.preTokenBalances && !sim.postTokenBalances) return null;
  const sum = (list: RollQuoteSimResult["postTokenBalances"]) =>
    (list ?? [])
      .filter((b) => b.mint === mint && b.owner === owner)
      .reduce((acc, b) => acc + BigInt(b.amount), 0n);
  return sum(sim.postTokenBalances) - sum(sim.preTokenBalances);
}

// The IDL declares the full `TradePtEvent` (amount_out at byte 138), but the deployed program
// returns a compact 16-byte pair: the field equal to `amountIn` identifies the layout
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

// Quotes by simulating a standalone `trade_pt` from a large SY holder: a CLMM swap's output
// doesn't depend on who trades, and a short standalone simulation's `returnData` is reliable where
// the flashloan's logs truncate. `sigVerify` is off, so neither the payer nor the holder signs.
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
    throw TransactionBuildingError.swapQuoteFailed(
      "exponent",
      clmm.sy.mint,
      clmm.pt.mint,
      "no SY holder large enough to quote the buy: the roll exceeds the pool's liquidity"
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
    txFormat: { version: 0, luts: { [clmm.lookupTable.address]: clmm.lookupTable.addresses } },
  });
  const sim = await simulateTx(compileTransaction(message));

  // Bundle-sim transports report token balances; the trade is the trader's only PT movement
  const delta = tokenBalanceDelta(sim, clmm.pt.mint, trader);
  if (delta !== null && delta > 0n) return delta;

  const rd = sim.returnData;
  if (rd?.data && rd.programId === EXPONENT_CLMM_PROGRAM_ADDRESS) {
    const out = readTradePtOut(getBase64Encoder().encode(rd.data[0]), amountInSyNative);
    if (out !== null && out > 0n) return out;
  }

  throw TransactionBuildingError.swapQuoteFailed(
    "exponent",
    clmm.sy.mint,
    clmm.pt.mint,
    `the quote simulation returned no readable output (err=${JSON.stringify(sim.err)})`
  );
}
