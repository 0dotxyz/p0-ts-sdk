import { BigNumber } from "bignumber.js";
import {
  AddressLookupTableAccount,
  PublicKey,
  TransactionInstruction,
  VersionedTransaction,
} from "@solana/web3.js";

import {
  addTransactionMetadata,
  decompileV0Transaction,
  ExtendedV0Transaction,
  SolanaTransaction,
  splitInstructionsToFitTransactions,
  TransactionType,
} from "~/services/transaction";
import { BankType } from "~/services/bank";
import { MarginfiProgram } from "~/types";
import { MarginfiAccount } from "~/models/account";
import { Balance } from "~/models/balance";

import { computeProjectedActiveBalancesNoCpi } from "../utils";
import { MarginfiAccountType, SwapQuoteResult } from "../types";

/**
 * Bridge / double-hop swaps — the flow-agnostic mechanics.
 *
 * When a single swap op (collateral-swap / debt-swap / loop) can't fit the per-tx limits (1232
 * bytes AND 64 account-locks) for a pair, the caller decomposes it into two ops through a
 * high-liquidity BRIDGE token and submits both as ONE atomic Jito bundle (one merged quote, one
 * signature). This module owns the parts that are identical across flows and encode marginfi
 * internals; the caller owns bridge *selection* (product policy) and per-flow leg building/sizing.
 *
 * Two non-obvious invariants are baked in here so no caller has to rediscover them:
 *
 *  1. **Cranks cannot be merged across legs.** Each leg's Switchboard On-Demand crank carries oracle
 *     responses signed for a specific slot; combining op1's and op2's crank instructions in one tx
 *     breaks Switchboard consensus verification. So each leg's crank stays its own tx, immediately
 *     before that leg's flashloan. Only setup (ATA-create) txs — which are slot-independent — are
 *     merged. Worst case is 5 txs (`setup, op1crank, op1FL, op2crank, op2FL`), Jito's ceiling; the
 *     bundle-tip instruction fits in-place in the small setup/crank txs.
 *
 *  2. **op2 must be built against op1's full projected effect.** op2 touches collateral/debt that op1
 *     mutates but hasn't executed yet at build time. Built against the raw account, op2's
 *     flashloan/crank balance projection either throws ("balance should be projected active") or
 *     references a stale bank op1 already closed (InvalidBankAccount). So op2 is built against a
 *     clone of the account with op1's own instructions replayed onto it. The bundle is atomic, so at
 *     execution this state really holds.
 */

/** Default max txs in a bridged bundle: setup + op1crank + op1FL + op2crank + op2FL = Jito ceiling. */
const MAX_BRIDGED_BUNDLE_TXS = 5;

/** A single built swap leg (its txs + the swap-engine quote). */
export interface BridgedSwapLeg {
  transactions: SolanaTransaction[];
  quoteResponse: SwapQuoteResult | undefined;
}

export interface ComposeBridgedSwapParams {
  /** The already-built first leg (A → bridge). */
  op1: BridgedSwapLeg;
  /**
   * Build the second leg (bridge → C) against op1's projected post-state. The caller sizes op2 from
   * op1's guaranteed output/borrow (so op2 can't fail from op1 slippage) and passes the supplied
   * `projectedAccount` as the leg's marginfi account.
   */
  buildOp2: (projectedAccount: MarginfiAccountType) => Promise<BridgedSwapLeg>;
  marginfiAccount: MarginfiAccountType;
  program: MarginfiProgram;
  banksMap: Map<string, BankType>;
  /** Per-bank cToken multiplier (1 for vanilla SPL banks) — for op1's effect projection. */
  assetShareValueMultiplierByBank: Map<string, BigNumber>;
  feePayer: PublicKey;
  /** Override the bundle-size ceiling (default {@link MAX_BRIDGED_BUNDLE_TXS}). */
  maxBundleTxs?: number;
}

export interface ComposeBridgedSwapResult {
  /** The atomic bundle: `[mergedSetup?, op1crank?, op1FL, op2crank?, op2FL]`. */
  transactions: SolanaTransaction[];
  /**
   * The two legs' raw quotes. Presentation (the user-facing merged quote and destination amount) is
   * flow-specific — collateral maps `op1.in → op2.out`, debt maps `op1.out → op2.in`, etc. — so the
   * caller builds it (see {@link mergeBridgeQuotes} for the collateral/loop-deposit shape).
   */
  op1Quote: SwapQuoteResult;
  op2Quote: SwapQuoteResult;
}

interface ClassifiedTxs {
  setups: ExtendedV0Transaction[];
  cranks: ExtendedV0Transaction[];
  flashloans: ExtendedV0Transaction[]; // order preserved
}

function classify(txs: SolanaTransaction[]): ClassifiedTxs {
  const out: ClassifiedTxs = { setups: [], cranks: [], flashloans: [] };
  for (const tx of txs as ExtendedV0Transaction[]) {
    if (tx.type === TransactionType.CREATE_ATA) out.setups.push(tx);
    else if (tx.type === TransactionType.CRANK) out.cranks.push(tx);
    else out.flashloans.push(tx); // FLASHLOAN / LOOP / REPAY_COLLAT / …
  }
  return out;
}

/** Structural identity of an instruction (program + ordered keys + data) — for setup dedupe. */
function ixIdentity(ix: TransactionInstruction): string {
  const keys = ix.keys.map((k) => k.pubkey.toBase58()).join(",");
  return `${ix.programId.toBase58()}|${keys}|${Buffer.from(ix.data).toString("base64")}`;
}

/**
 * Merge both legs' setup (ATA-create) txs into ONE tx: decompile each, concat instructions (dedupe
 * by structural identity — op1/op2 share the bridge ATA-create), union LUTs, recompile. Returns
 * null if the merged instructions don't fit a single tx. (Cranks are NOT merged — see module doc.)
 */
function mergeSetupTxs(
  txs: ExtendedV0Transaction[],
  payer: PublicKey,
  blockhash: string,
): ExtendedV0Transaction | null {
  if (txs.length === 0) return null;
  if (txs.length === 1) return txs[0]!;

  const lutMap = new Map<string, AddressLookupTableAccount>();
  const seen = new Set<string>();
  const ixs: TransactionInstruction[] = [];
  for (const tx of txs) {
    const luts = (tx.addressLookupTables ?? []) as AddressLookupTableAccount[];
    luts.forEach((l) => lutMap.set(l.key.toBase58(), l));
    const msg = decompileV0Transaction(tx as VersionedTransaction, luts);
    for (const ix of msg.instructions) {
      const id = ixIdentity(ix);
      if (seen.has(id)) continue;
      seen.add(id);
      ixs.push(ix);
    }
  }

  const luts = [...lutMap.values()];
  const split = splitInstructionsToFitTransactions([], ixs, { blockhash, payerKey: payer, luts });
  if (split.length !== 1) return null; // merged setup spilled to >1 tx
  return addTransactionMetadata(split[0]!, {
    type: TransactionType.CREATE_ATA,
    addressLookupTables: luts,
  }) as ExtendedV0Transaction;
}

/**
 * Build the account op2 must be built against: a clone of `account` with op1's own instructions
 * replayed onto it (the source removed, the bridge added — with the exact withdraw-all/borrow
 * semantics op1 actually used). See invariant (2) in the module doc.
 */
function projectOp1Effect(
  account: MarginfiAccountType,
  op1FlashloanTxs: SolanaTransaction[],
  program: MarginfiProgram,
  banksMap: Map<string, BankType>,
  multipliers: Map<string, BigNumber>,
): MarginfiAccountType {
  const ixs: TransactionInstruction[] = [];
  for (const tx of op1FlashloanTxs as ExtendedV0Transaction[]) {
    const luts = (tx.addressLookupTables ?? []) as AddressLookupTableAccount[];
    ixs.push(...decompileV0Transaction(tx as VersionedTransaction, luts).instructions);
  }

  const { projectedBalances } = computeProjectedActiveBalancesNoCpi(
    account.balances,
    ixs,
    program,
    banksMap,
    multipliers,
  );

  return new MarginfiAccount(
    account.address,
    account.group,
    account.authority,
    projectedBalances.map((b) => Balance.fromBalanceType(b)),
    account.accountFlags,
    account.emissionsDestinationAccount,
    account.healthCache,
  );
}

/**
 * Compose the two legs into one ordered bundle. Setups merge to one tx; cranks stay separate, each
 * immediately before its flashloan. Returns null if the merge spills or the bundle exceeds the cap.
 */
function composeBundle(
  op1Txs: SolanaTransaction[],
  op2Txs: SolanaTransaction[],
  payer: PublicKey,
  blockhash: string,
  maxBundleTxs: number,
): SolanaTransaction[] | null {
  const c1 = classify(op1Txs);
  const c2 = classify(op2Txs);

  const mergedSetup = mergeSetupTxs([...c1.setups, ...c2.setups], payer, blockhash);
  if ([...c1.setups, ...c2.setups].length > 0 && !mergedSetup) return null;

  const result: SolanaTransaction[] = [
    ...(mergedSetup ? [mergedSetup] : []),
    ...c1.cranks,
    ...c1.flashloans, // op1FL(s)
    ...c2.cranks,
    ...c2.flashloans, // op2FL(s)
  ];
  if (result.length > maxBundleTxs) return null;
  return result;
}

/**
 * Merge two leg quotes into one user-facing quote for the "in = op1 input, out = op2 output" shape
 * (collateral-swap, loop-deposit): A in → C out, with compounded slippage and price-impact. Flows
 * with different semantics (debt-swap: old-debt in → new-debt out) build their own.
 */
export function mergeBridgeQuotes(op1: SwapQuoteResult, op2: SwapQuoteResult): SwapQuoteResult {
  const compound = (a?: string, b?: string): string | undefined => {
    if (a == null && b == null) return undefined;
    const x = Number(a ?? 0);
    const y = Number(b ?? 0);
    return String(1 - (1 - x) * (1 - y));
  };
  return {
    inAmount: op1.inAmount,
    outAmount: op2.outAmount,
    otherAmountThreshold: op2.otherAmountThreshold,
    slippageBps: Math.round(
      (1 - (1 - op1.slippageBps / 10_000) * (1 - op2.slippageBps / 10_000)) * 10_000,
    ),
    priceImpactPct: compound(op1.priceImpactPct, op2.priceImpactPct),
    provider: op1.provider,
  };
}

/** A throwaway blockhash for re-compiling merged setup txs (rewritten at submission). */
function blockhashOf(leg: BridgedSwapLeg): string {
  const tx = leg.transactions[0] as ExtendedV0Transaction | undefined;
  return tx ? tx.message.recentBlockhash : PublicKey.default.toBase58();
}

/**
 * Compose an already-built first leg and a caller-built second leg into one atomic bridged-swap
 * bundle. Owns the flow-agnostic mechanics — op1-effect projection, separate-crank composition, and
 * quote merging (see module doc for the invariants). Returns null if op2 can't be quoted or the
 * bundle doesn't fit; the caller treats that as "this bridge candidate didn't work, try the next".
 */
export async function composeBridgedSwap(
  params: ComposeBridgedSwapParams,
): Promise<ComposeBridgedSwapResult | null> {
  const {
    op1,
    buildOp2,
    marginfiAccount,
    program,
    banksMap,
    assetShareValueMultiplierByBank,
    feePayer,
    maxBundleTxs = MAX_BRIDGED_BUNDLE_TXS,
  } = params;

  if (!op1.quoteResponse) return null;

  const projectedAccount = projectOp1Effect(
    marginfiAccount,
    classify(op1.transactions).flashloans,
    program,
    banksMap,
    assetShareValueMultiplierByBank,
  );

  const op2 = await buildOp2(projectedAccount);
  if (!op2.quoteResponse) return null;

  const transactions = composeBundle(
    op1.transactions,
    op2.transactions,
    feePayer,
    blockhashOf(op1),
    maxBundleTxs,
  );
  if (!transactions) return null;

  return { transactions, op1Quote: op1.quoteResponse, op2Quote: op2.quoteResponse };
}
