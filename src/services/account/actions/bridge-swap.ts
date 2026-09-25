import {
  getBase64Decoder,
  type Address,
  type BlockhashLifetimeConstraint,
  type Instruction,
  type TransactionSigner,
} from "@solana/kit";
import { BigNumber } from "bignumber.js";

import { MarginfiAccountType, SwapQuoteResult } from "../types";
import { computeProjectedActiveBalancesNoCpi } from "../utils";

import { BankType } from "~/services/bank";
import {
  SolanaTransaction,
  splitInstructionsToFitTransactions,
  TransactionType,
} from "~/services/transaction";

/**
 * Bridge / double-hop swaps — the flow-agnostic mechanics.
 *
 * When a single swap op (collateral-swap / debt-swap / loop) can't fit the per-tx limits (1232
 * bytes AND 64 account-locks) for a pair, the caller decomposes it into two ops through a
 * high-liquidity BRIDGE token and submits both as ONE atomic Jito bundle (one merged quote, one
 * signature). This module owns the parts that are identical across flows and encode marginfi
 * internals; per-flow leg building/sizing lives in the one-call `makeBridged*Tx` builders next to
 * their direct builders (`./loop.ts`, `./swap-collateral.ts`, `./swap-debt.ts`), backed by the
 * shared selection/iteration support in `../utils/bridge-routing.utils.ts`, with candidate
 * ordering still injectable per call (product policy).
 *
 * Two non-obvious invariants are baked in here so no caller has to rediscover them:
 *
 *  1. **Cranks cannot be merged across legs.** An oracle crank carries responses signed for a specific
 *     slot; combining the first and second legs' crank instructions in one tx breaks their verification.
 *     So each leg's crank stays its own tx, immediately before that leg's flashloan. Only setup
 *     (ATA-create) txs — which are slot-independent — are merged. Worst case is 5 txs (`setup,
 *     firstLegCrank, firstLegFL, secondLegCrank, secondLegFL`), Jito's ceiling; the bundle-tip
 *     instruction fits in-place in the small setup/crank txs. (Legs emit no crank txs since Switchboard
 *     cranking was removed; the separation is kept for any future slot-bound oracle update.)
 *
 *  2. **The second leg must be built against the first leg's full projected effect.** It touches
 *     collateral/debt the first leg mutates but hasn't executed yet at build time. Built against the raw
 *     account, the second leg's flashloan/crank balance projection either throws ("balance should be
 *     projected active") or references a stale bank the first leg already closed (InvalidBankAccount). So
 *     the second leg is built against a clone of the account with the first leg's own instructions
 *     replayed onto it. The bundle is atomic, so at execution this state really holds.
 */

/** Default max txs in a bridged bundle: setup + firstLegCrank + firstLegFL + secondLegCrank + secondLegFL = Jito ceiling. */
const MAX_BRIDGED_BUNDLE_TXS = 5;

/** A single built swap leg (its txs + the swap-engine quote). */
export interface BridgedSwapLeg {
  transactions: SolanaTransaction[];
  quoteResponse: SwapQuoteResult | undefined;
}

export interface ComposeBridgedSwapParams {
  /** The already-built first leg (A → bridge). */
  firstLeg: BridgedSwapLeg;
  /**
   * Build the second leg (bridge → C) against the first leg's projected post-state. The caller sizes it
   * from the first leg's guaranteed output/borrow (so it can't fail from first-leg slippage) and passes
   * the supplied `projectedAccount` as the leg's marginfi account.
   */
  buildSecondLeg: (projectedAccount: MarginfiAccountType) => Promise<BridgedSwapLeg>;
  marginfiAccount: MarginfiAccountType;
  programAddress: Address;
  banksMap: Map<string, BankType>;
  /** Per-bank cToken multiplier (1 for vanilla SPL banks) — for the first leg's effect projection. */
  assetShareValueMultiplierByBank: Map<string, BigNumber>;
  feePayer: TransactionSigner;
  /** Override the bundle-size ceiling (default {@link MAX_BRIDGED_BUNDLE_TXS}). */
  maxBundleTxs?: number;
}

export interface ComposeBridgedSwapResult {
  /** The atomic bundle: `[mergedSetup?, firstLegCrank?, firstLegFL, secondLegCrank?, secondLegFL]`. */
  transactions: SolanaTransaction[];
  /**
   * The two legs' raw quotes. Presentation (the user-facing merged quote and destination amount) is
   * flow-specific — collateral maps `firstLeg.in → secondLeg.out`, debt maps `firstLeg.out → secondLeg.in`, etc. — so the
   * caller builds it (see {@link mergeBridgeQuotes} for the collateral/loop-deposit shape).
   */
  firstLegQuote: SwapQuoteResult;
  secondLegQuote: SwapQuoteResult;
}

interface ClassifiedTxs {
  setups: SolanaTransaction[];
  cranks: SolanaTransaction[];
  flashloans: SolanaTransaction[]; // order preserved
}

function classifyTxs(txs: SolanaTransaction[]): ClassifiedTxs {
  const out: ClassifiedTxs = { setups: [], cranks: [], flashloans: [] };
  for (const tx of txs) {
    if (tx.type === TransactionType.CREATE_ATA) out.setups.push(tx);
    else if (tx.type === TransactionType.CRANK) out.cranks.push(tx);
    else out.flashloans.push(tx); // FLASHLOAN / LOOP / REPAY_COLLAT / …
  }
  return out;
}

/** Structural identity of an instruction (program + ordered keys + data) — for setup dedupe. */
function ixIdentity(ix: Instruction): string {
  const keys = (ix.accounts ?? []).map((account) => account.address).join(",");
  return `${ix.programAddress}|${keys}|${getBase64Decoder().decode(ix.data ?? new Uint8Array())}`;
}

/**
 * Merge both legs' setup (ATA-create) txs into ONE tx: concat their instructions (dedupe by
 * structural identity — the first and second legs share the bridge ATA-create) and recompile. The
 * instructions keep their lookup-table accounts, so no tables are needed. Returns null if the
 * merged instructions don't fit a single tx. (Cranks are NOT merged — see module doc.)
 */
function mergeSetupTxs(
  txs: SolanaTransaction[],
  payer: TransactionSigner,
  latestBlockhash: BlockhashLifetimeConstraint
): SolanaTransaction | null {
  if (txs.length === 0) return null;
  if (txs.length === 1) return txs[0];

  const seen = new Set<string>();
  const ixs = txs
    .flatMap((tx) => tx.message.instructions)
    .filter((ix) => {
      const id = ixIdentity(ix);
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });

  const split = splitInstructionsToFitTransactions([], ixs, {
    latestBlockhash,
    feePayer: payer,
    luts: {},
  });
  if (split.length !== 1) return null; // merged setup spilled to >1 tx
  return { message: split[0], type: TransactionType.CREATE_ATA };
}

/**
 * Return `account` as it will look AFTER the first leg executes — its balances with the first
 * leg's own instructions replayed onto them (source position removed, bridge position added, using
 * the exact withdraw-all / borrow semantics the first leg used). The second leg must be built
 * against this projected account, not the raw one — see invariant (2) in the module doc.
 */
function projectAccountAfterFirstLeg(
  account: MarginfiAccountType,
  firstLegFlashloanTxs: SolanaTransaction[],
  programAddress: Address,
  banksMap: Map<string, BankType>,
  multipliers: Map<string, BigNumber>
): MarginfiAccountType {
  const { projectedBalances } = computeProjectedActiveBalancesNoCpi({
    account,
    instructions: firstLegFlashloanTxs.flatMap((tx) => tx.message.instructions),
    programAddress,
    banksMap,
    assetShareValueMultiplierByBank: multipliers,
  });

  return { ...account, balances: projectedBalances };
}

/**
 * Compose the two legs into one ordered bundle. Setups merge to one tx; cranks stay separate, each
 * immediately before its flashloan. Returns null if the merge spills or the bundle exceeds the cap.
 */
function composeBundle(
  firstLegTxs: SolanaTransaction[],
  secondLegTxs: SolanaTransaction[],
  payer: TransactionSigner,
  latestBlockhash: BlockhashLifetimeConstraint,
  maxBundleTxs: number
): SolanaTransaction[] | null {
  const c1 = classifyTxs(firstLegTxs);
  const c2 = classifyTxs(secondLegTxs);

  const mergedSetup = mergeSetupTxs([...c1.setups, ...c2.setups], payer, latestBlockhash);
  if ([...c1.setups, ...c2.setups].length > 0 && !mergedSetup) return null;

  const result: SolanaTransaction[] = [
    ...(mergedSetup ? [mergedSetup] : []),
    ...c1.cranks,
    ...c1.flashloans, // firstLegFL(s)
    ...c2.cranks,
    ...c2.flashloans, // secondLegFL(s)
  ];
  if (result.length > maxBundleTxs) return null;
  return result;
}

/**
 * Compound two legs' slippage and price-impact into the combined risk of the bridged route. Both are
 * "fraction of value lost" quantities, so they compound multiplicatively: `1 - (1 - a)(1 - b)`.
 * Shared by all three merge shapes below.
 */
function compoundQuoteRisk(
  firstLeg: SwapQuoteResult,
  secondLeg: SwapQuoteResult
): { slippageBps: number; priceImpactPct: string | undefined } {
  const compound = (a?: string, b?: string): string | undefined => {
    if (a == null && b == null) return undefined;
    const x = Number(a ?? 0);
    const y = Number(b ?? 0);
    return String(1 - (1 - x) * (1 - y));
  };
  return {
    slippageBps: Math.round(
      (1 - (1 - firstLeg.slippageBps / 10_000) * (1 - secondLeg.slippageBps / 10_000)) * 10_000
    ),
    priceImpactPct: compound(firstLeg.priceImpactPct, secondLeg.priceImpactPct),
  };
}

/**
 * Merge two leg quotes for the "in = first-leg input, out = second-leg output" shape
 * (collateral-swap, loop-deposit): A in → C out, with compounded slippage and price-impact.
 */
export function mergeBridgeQuotes(
  firstLeg: SwapQuoteResult,
  secondLeg: SwapQuoteResult
): SwapQuoteResult {
  return {
    inAmount: firstLeg.inAmount,
    outAmount: secondLeg.outAmount,
    otherAmountThreshold: secondLeg.otherAmountThreshold,
    ...compoundQuoteRisk(firstLeg, secondLeg),
    provider: firstLeg.provider,
  };
}

/**
 * Merge two leg quotes for a bridged DEBT swap (repay A → borrow bridge, then repay bridge → borrow
 * C). The user-facing quote maps old-debt-repaid (first leg's *output*) → new-debt-borrowed (second
 * leg's *input*).
 */
export function mergeBridgeQuotesDebt(
  firstLeg: SwapQuoteResult,
  secondLeg: SwapQuoteResult
): SwapQuoteResult {
  return {
    inAmount: firstLeg.outAmount,
    outAmount: secondLeg.inAmount,
    otherAmountThreshold: secondLeg.inAmount,
    ...compoundQuoteRisk(firstLeg, secondLeg),
    provider: firstLeg.provider,
  };
}

/**
 * Merge two leg quotes for a bridged LOOP (loop-deposit borrowing the bridge, then debt-swap bridge
 * → X). The user-facing quote maps new-debt-borrowed (second leg's *input*) → collateral-deposited
 * (first leg's *output*).
 */
export function mergeBridgeQuotesLoop(
  firstLeg: SwapQuoteResult,
  secondLeg: SwapQuoteResult
): SwapQuoteResult {
  return {
    inAmount: secondLeg.inAmount,
    outAmount: firstLeg.outAmount,
    otherAmountThreshold: firstLeg.otherAmountThreshold,
    ...compoundQuoteRisk(firstLeg, secondLeg),
    provider: firstLeg.provider,
  };
}

/**
 * Compose an already-built first leg and a caller-built second leg into one atomic bridged-swap
 * bundle. Owns the flow-agnostic mechanics — first-leg-effect projection, separate-crank composition, and
 * quote merging (see module doc for the invariants). Returns null if the second leg can't be quoted or the
 * bundle doesn't fit; the caller treats that as "this bridge candidate didn't work, try the next".
 */
export async function composeBridgedSwap(
  params: ComposeBridgedSwapParams
): Promise<ComposeBridgedSwapResult | null> {
  const {
    firstLeg,
    buildSecondLeg,
    marginfiAccount,
    programAddress,
    banksMap,
    assetShareValueMultiplierByBank,
    feePayer,
    maxBundleTxs = MAX_BRIDGED_BUNDLE_TXS,
  } = params;

  if (!firstLeg.quoteResponse) return null;

  const projectedAccount = projectAccountAfterFirstLeg(
    marginfiAccount,
    classifyTxs(firstLeg.transactions).flashloans,
    programAddress,
    banksMap,
    assetShareValueMultiplierByBank
  );

  const secondLeg = await buildSecondLeg(projectedAccount);
  if (!secondLeg.quoteResponse) return null;

  const transactions = composeBundle(
    firstLeg.transactions,
    secondLeg.transactions,
    feePayer,
    firstLeg.transactions[0].message.lifetimeConstraint,
    maxBundleTxs
  );
  if (!transactions) return null;

  return {
    transactions,
    firstLegQuote: firstLeg.quoteResponse,
    secondLegQuote: secondLeg.quoteResponse,
  };
}
