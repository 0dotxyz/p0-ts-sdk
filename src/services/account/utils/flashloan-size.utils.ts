/**
 * Synchronous flashloan TX size estimator.
 *
 * Estimates the serialized size of a V0 flashloan transaction without compiling
 * or serializing the message. This allows us to synchronously compute the byte
 * overhead of non-swap instructions and determine how much budget remains for
 * the swap IX (e.g. Titan).
 *
 * Thoroughly tested using R&D scripts (rnd-flashloan-size.ts) and cross-referenced
 * against actual serialized transaction sizes across all action types (Loop, Repay,
 * SwapCollateral, SwapDebt) and asset tag variants (Standard, Kamino, Drift).
 */

import {
  blockhash,
  compileTransactionMessage,
  createNoopSigner,
  getTransactionMessageSize,
  getTransactionMessageSizeLimit,
  type Address,
  type AddressesByLookupTableAddress,
  type Instruction,
} from "@solana/kit";
import {
  getSetComputeUnitLimitInstruction,
  getSetComputeUnitPriceInstruction,
} from "@solana-program/compute-budget";

import { makeBorrowIx } from "../actions/borrow";
import { makeDepositIx } from "../actions/deposit";
import { makeFlashLoanTx } from "../actions/flash-loan";
import { makeRepayIx } from "../actions/repay";
import { makeWithdrawIx } from "../actions/withdraw";
import { MarginfiAccountType } from "../types";

import { MAX_ACCOUNT_LOCKS, MAX_TX_SIZE } from "~/constants";
import { BankType } from "~/services/bank";
import {
  getTotalAccountKeys,
  makeTransactionMessage,
  TransactionVersionParams,
} from "~/services/transaction";
import { BankIntegrationMetadataMap } from "~/types";

// V0 message compilation is non-additive: merging swap LUTs with non-swap LUTs
// causes the compiler to redistribute key resolution. Multi-hop routes add many
// unique program IDs (always static) and new LUT addresses. Observed merge
// overhead varies by route complexity: 25–191 bytes. 200 bytes covers worst
// observed case and forces Titan to prefer simpler routes with lower overhead.
const SWAP_MERGE_OVERHEAD = 150;

// BeginFL + EndFL instructions add ~52 bytes to the IX section. The precheck
// compiles without FL IXs, so we add this constant to get an accurate estimate.
const FL_IX_OVERHEAD = 52;

// Stand-in raw size for a tx too large to even encode. Any value comfortably over MAX_TX_SIZE
// works — it only needs to make `overshoot` positive so the route is scored as "doesn't fit"
// instead of crashing.
const OVERSIZED_TX_SENTINEL = MAX_TX_SIZE * 4;

// Size-only compilation needs a lifetime; any 32-byte blockhash gives the exact size.
const SIZING_BLOCKHASH = {
  blockhash: blockhash("11111111111111111111111111111111"),
  lastValidBlockHeight: 0n,
};

export interface FlashloanSwapConstraints {
  /** Available bytes for swap instruction(s) */
  sizeConstraint: number;
  /** Available total account slots for swap instruction(s) */
  maxSwapTotalAccounts: number;
}

/**
 * Compute the available byte budget and account budget for swap instructions
 * in a flashloan TX. Compiles a real V0 message and serializes it for an exact
 * non-swap byte count.
 *
 * @param ixs - The non-swap IXs (CU requests + primary + secondary).
 *              Must NOT include BeginFL/EndFL — those are synthesized internally.
 */
export async function computeFlashLoanNonSwapBudget({
  programAddress,
  marginfiAccount,
  ixs,
  bankMap,
  addressLookupTableAccounts,
}: {
  programAddress: Address;
  marginfiAccount: MarginfiAccountType;
  ixs: Instruction[];
  bankMap: Map<string, BankType>;
  addressLookupTableAccounts: AddressesByLookupTableAddress;
}): Promise<FlashloanSwapConstraints> {
  const { message: nonSwapMsg } = await makeFlashLoanTx({
    programAddress,
    marginfiAccount,
    authority: createNoopSigner(marginfiAccount.authority),
    bankMap,
    ixs,
    latestBlockhash: SIZING_BLOCKHASH,
    luts: addressLookupTableAccounts,
  });
  const nonSwapSize = getTransactionMessageSize(nonSwapMsg);
  const nonSwapTotal = getTotalAccountKeys(nonSwapMsg);

  const sizeConstraint = MAX_TX_SIZE - nonSwapSize - SWAP_MERGE_OVERHEAD;
  const maxSwapTotalAccounts = MAX_ACCOUNT_LOCKS - nonSwapTotal;

  console.log("[flashloan-budget]", {
    method: "compiled",
    nonSwapSize,
    nonSwapTotal,
    sizeConstraint,
    maxSwapTotalAccounts,
  });

  return { sizeConstraint, maxSwapTotalAccounts };
}

export interface FlashloanPrecheckResult {
  /** Exact serialized size of the full flashloan TX */
  fullTxSize: number;
  /** How many bytes over the version's size limit (negative = under budget) */
  overshoot: number;
  /** Total writable accounts in the full TX */
  writableAccounts: number;
  /** Total accounts (static + LUT) in the full TX */
  totalAccounts: number;
}

/**
 * Compile the full flashloan TX (all IXs + all LUTs) and return exact size info.
 * Call this AFTER receiving swap IXs but BEFORE makeFlashLoanTx to detect overflows
 * early with good diagnostics.
 *
 * Uses a dummy blockhash (same 32 bytes as a real one) so the size is exact.
 */
export function compileFlashloanPrecheck({
  allIxs,
  payer,
  luts,
  sizeConstraint,
  swapIxCount,
  swapLutCount,
  version,
}: {
  allIxs: Instruction[];
  payer: Address;
  luts: AddressesByLookupTableAddress;
  sizeConstraint: number;
  swapIxCount: number;
  swapLutCount: number;
} & TransactionVersionParams): FlashloanPrecheckResult {
  const msg = makeTransactionMessage({
    instructions: allIxs,
    feePayer: createNoopSigner(payer),
    latestBlockhash: SIZING_BLOCKHASH,
    luts,
    version,
  });

  // A message too large to even encode (e.g. more than 256 accounts) throws; that just means the
  // tx is grossly oversized, so treat it as a large positive overshoot (route "doesn't fit") rather
  // than letting it escape — callers (e.g. the swap engine's annotateFit) score on `overshoot`.
  let rawSize: number;
  let compiled: ReturnType<typeof compileTransactionMessage>;
  try {
    compiled = compileTransactionMessage(msg);
    rawSize = getTransactionMessageSize(msg);
  } catch {
    return {
      fullTxSize: OVERSIZED_TX_SENTINEL + FL_IX_OVERHEAD,
      overshoot: OVERSIZED_TX_SENTINEL + FL_IX_OVERHEAD - MAX_TX_SIZE,
      writableAccounts: 0,
      totalAccounts: 0,
    };
  }
  const fullTxSize = rawSize + FL_IX_OVERHEAD;
  const overshoot = fullTxSize - getTransactionMessageSizeLimit(msg);

  const { header, staticAccounts } = compiled;
  const addressTableLookups =
    "addressTableLookups" in compiled ? (compiled.addressTableLookups ?? []) : [];
  const writableStatic =
    staticAccounts.length - header.numReadonlySignerAccounts - header.numReadonlyNonSignerAccounts;
  const writableLut = addressTableLookups.reduce((s, l) => s + l.writableIndexes.length, 0);
  const writableAccounts = writableStatic + writableLut;
  const totalAccounts =
    staticAccounts.length +
    addressTableLookups.reduce(
      (s, l) => s + l.writableIndexes.length + l.readonlyIndexes.length,
      0
    );

  console.log("[flashloan-precheck]", {
    fullTxSize,
    overshoot,
    sizeConstraint,
    writableAccounts,
    totalAccounts,
    staticKeys: staticAccounts.length,
    numLuts: addressTableLookups.length,
    swapIxCount,
    swapLutCount,
  });

  return { fullTxSize, overshoot, writableAccounts, totalAccounts };
}

export type FlashloanBudgetIx =
  | { type: "borrow"; bank: BankType; tokenProgram: Address }
  | { type: "repay"; bank: BankType; tokenProgram: Address }
  | { type: "deposit"; bank: BankType; tokenProgram: Address }
  | { type: "withdraw"; bank: BankType; tokenProgram: Address };

/** Build dummy IXs for a single budget entry using the action IX builders. */
async function buildBudgetIx(
  { type, bank, tokenProgram }: FlashloanBudgetIx,
  programAddress: Address,
  marginfiAccount: MarginfiAccountType,
  bankMap: Map<string, BankType>,
  bankMetadataMap: BankIntegrationMetadataMap
): Promise<Instruction[]> {
  const common = {
    programAddress,
    bank,
    tokenProgram,
    amount: 1,
    marginfiAccount,
    authority: createNoopSigner(marginfiAccount.authority),
  };

  switch (type) {
    case "borrow":
      return makeBorrowIx({
        ...common,
        bankMap,
        opts: { createAtas: false, wrapAndUnwrapSol: false },
      });
    case "repay":
      return makeRepayIx({ ...common, repayAll: false, opts: { wrapAndUnwrapSol: false } });
    case "deposit":
      return makeDepositIx({ ...common, bankMetadataMap, opts: { wrapAndUnwrapSol: false } });
    case "withdraw":
      return makeWithdrawIx({
        ...common,
        bankMap,
        bankMetadataMap,
        withdrawAll: false,
        opts: { createAtas: false, wrapAndUnwrapSol: false },
      });
  }
}

/**
 * Compute flashloan swap constraints by building dummy primary + secondary IXs
 * and measuring the remaining TX budget. Replaces the duplicated switch/case
 * blocks in each action file.
 */
export async function computeFlashloanSwapConstraints({
  programAddress,
  marginfiAccount,
  bankMap,
  luts,
  bankMetadataMap,
  primaryIx,
  secondaryIx,
}: {
  programAddress: Address;
  marginfiAccount: MarginfiAccountType;
  bankMap: Map<string, BankType>;
  luts: AddressesByLookupTableAddress;
  bankMetadataMap: BankIntegrationMetadataMap;
  primaryIx: FlashloanBudgetIx;
  secondaryIx: FlashloanBudgetIx;
}): Promise<FlashloanSwapConstraints> {
  const cuRequestIxs = [
    getSetComputeUnitLimitInstruction({ units: 1_200_000 }),
    getSetComputeUnitPriceInstruction({ microLamports: 1 }),
  ];

  const [primaryIxs, secondaryIxs] = await Promise.all([
    buildBudgetIx(primaryIx, programAddress, marginfiAccount, bankMap, bankMetadataMap),
    buildBudgetIx(secondaryIx, programAddress, marginfiAccount, bankMap, bankMetadataMap),
  ]);

  return computeFlashLoanNonSwapBudget({
    programAddress,
    marginfiAccount,
    bankMap,
    addressLookupTableAccounts: luts,
    ixs: [...cuRequestIxs, ...primaryIxs, ...secondaryIxs],
  });
}
