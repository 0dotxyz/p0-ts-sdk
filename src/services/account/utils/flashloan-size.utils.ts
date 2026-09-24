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
  AccountRole,
  blockhash,
  compileTransactionMessage,
  createNoopSigner,
  getTransactionMessageSize,
  type Address,
  type AddressesByLookupTableAddress,
  type Instruction,
} from "@solana/kit";
import { ComputeBudgetProgram, PublicKey } from "@solana/web3.js";

import { makeBorrowIx } from "../actions/borrow";
import {
  makeDepositIx,
  makeDriftDepositIx,
  makeJuplendDepositIx,
  makeKaminoDepositIx,
} from "../actions/deposit";
import { makeRepayIx } from "../actions/repay";
import {
  makeDriftWithdrawIx,
  makeJuplendWithdrawIx,
  makeKaminoWithdrawIx,
  makeWithdrawIx,
} from "../actions/withdraw";
import { MarginfiAccountType } from "../types";

import { computeHealthAccountMetas, computeProjectedActiveBanksNoCpi } from "./compute";

import { MAX_ACCOUNT_LOCKS, MAX_TX_SIZE } from "~/constants";
import { TransactionBuildingError } from "~/errors";
import instructions from "~/instructions";
import { AssetTag, BankType } from "~/services/bank";
import {
  getTotalAccountKeys,
  InstructionsWrapper,
  makeTransactionMessage,
} from "~/services/transaction";
import { BankIntegrationMetadataMap, MarginfiProgram } from "~/types";

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

// ============================================================================
// Flashloan swap budget estimator
// ============================================================================

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
  // 1. Project which banks will be active after the primary IXs execute
  const projectedActiveBanksKeys = computeProjectedActiveBanksNoCpi({
    account: marginfiAccount,
    instructions: ixs,
    programAddress,
  });
  const projectedActiveBanks = projectedActiveBanksKeys.map((key) => {
    const b = bankMap.get(key);
    if (!b) throw new Error(`Bank ${key} not found in computeFlashLoanNonSwapBudget`);
    return b;
  });

  // 2. Build BeginFL and EndFL IXs
  const authority = createNoopSigner(marginfiAccount.authority);
  const endIndex = ixs.length + 1; // BeginFL is at index 0, EndFL at endIndex
  const beginFlIx = await instructions.makeBeginFlashLoanIx(programAddress, {
    marginfiAccount: marginfiAccount.address,
    authority,
    endIndex: BigInt(endIndex),
  });

  const endFlRemainingAccounts = computeHealthAccountMetas({
    banksToInclude: projectedActiveBanks,
  });
  const endFlIx = await instructions.makeEndFlashLoanIx(
    programAddress,
    { marginfiAccount: marginfiAccount.address, group: marginfiAccount.group, authority },
    endFlRemainingAccounts.map((address) => ({ address, role: AccountRole.READONLY }))
  );

  // 3. Assemble all non-swap IXs in flashloan order
  const allNonSwapIxs = [beginFlIx, ...ixs, endFlIx];

  // 4. Compile a real V0 message for the exact non-swap size
  const nonSwapMsg = makeTransactionMessage({
    instructions: allNonSwapIxs,
    feePayer: authority,
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

// ============================================================================
// Post-swap pre-check: compile full TX to verify it fits before makeFlashLoanTx
// ============================================================================

export interface FlashloanPrecheckResult {
  /** Exact serialized size of the full flashloan TX */
  fullTxSize: number;
  /** How many bytes over MAX_TX_SIZE (negative = under budget) */
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
}: {
  allIxs: Instruction[];
  payer: Address;
  luts: AddressesByLookupTableAddress;
  sizeConstraint: number;
  swapIxCount: number;
  swapLutCount: number;
}): FlashloanPrecheckResult {
  const msg = makeTransactionMessage({
    instructions: allIxs,
    feePayer: createNoopSigner(payer),
    latestBlockhash: SIZING_BLOCKHASH,
    luts,
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
  const overshoot = fullTxSize - MAX_TX_SIZE;

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

// ============================================================================
// High-level helper: build budget IXs + compute constraints in one call
// ============================================================================

export type FlashloanBudgetIx =
  | { type: "borrow"; bank: BankType; tokenProgram: PublicKey }
  | { type: "repay"; bank: BankType; tokenProgram: PublicKey }
  | { type: "deposit"; bank: BankType; tokenProgram: PublicKey }
  | { type: "withdraw"; bank: BankType; tokenProgram: PublicKey };

/**
 * Build dummy IXs for a single budget entry using the existing async IX builders
 * with isSync: true. Switches on type + assetTag to pick the right variant.
 */
async function buildBudgetIx(
  config: FlashloanBudgetIx,
  program: MarginfiProgram,
  marginfiAccount: MarginfiAccountType,
  bankMap: Map<string, BankType>,
  bankMetadataMap: BankIntegrationMetadataMap,
  overrideInferAccounts?: { group?: PublicKey; authority?: PublicKey }
): Promise<InstructionsWrapper> {
  const { bank, tokenProgram } = config;

  switch (config.type) {
    case "borrow":
      return makeBorrowIx({
        program,
        bank,
        bankMap,
        tokenProgram,
        amount: 1,
        marginfiAccount,
        authority: marginfiAccount.authority,
        isSync: true,
        opts: { createAtas: false, wrapAndUnwrapSol: false, overrideInferAccounts },
      });

    case "repay":
      return makeRepayIx({
        program,
        bank,
        tokenProgram,
        amount: 1,
        accountAddress: marginfiAccount.address,
        authority: marginfiAccount.authority,
        repayAll: false,
        isSync: true,
        opts: { wrapAndUnwrapSol: false, overrideInferAccounts },
      });

    case "deposit":
      return buildDepositBudgetIx(
        config,
        program,
        marginfiAccount,
        bankMetadataMap,
        overrideInferAccounts
      );

    case "withdraw":
      return buildWithdrawBudgetIx(
        config,
        program,
        marginfiAccount,
        bankMap,
        bankMetadataMap,
        overrideInferAccounts
      );
  }
}

async function buildDepositBudgetIx(
  config: FlashloanBudgetIx & { type: "deposit" },
  program: MarginfiProgram,
  marginfiAccount: MarginfiAccountType,
  bankMetadataMap: BankIntegrationMetadataMap,
  overrideInferAccounts?: { group?: PublicKey; authority?: PublicKey }
): Promise<InstructionsWrapper> {
  const { bank, tokenProgram } = config;
  const opts = { wrapAndUnwrapSol: false, overrideInferAccounts };

  switch (bank.config.assetTag) {
    case AssetTag.KAMINO: {
      const reserve = bankMetadataMap[bank.address.toBase58()]?.kaminoStates?.reserveState;
      if (!reserve) {
        throw TransactionBuildingError.kaminoReserveNotFound(
          bank.address.toBase58(),
          bank.mint.toBase58(),
          bank.tokenSymbol
        );
      }
      return makeKaminoDepositIx({
        program,
        bank,
        tokenProgram,
        amount: 1,
        accountAddress: marginfiAccount.address,
        authority: marginfiAccount.authority,
        group: marginfiAccount.group,
        reserve,
        isSync: true,
        opts,
      });
    }
    case AssetTag.DRIFT: {
      const driftState = bankMetadataMap[bank.address.toBase58()]?.driftStates;
      if (!driftState) {
        throw TransactionBuildingError.driftStateNotFound(
          bank.address.toBase58(),
          bank.mint.toBase58(),
          bank.tokenSymbol
        );
      }
      return makeDriftDepositIx({
        program,
        bank,
        tokenProgram,
        amount: 1,
        accountAddress: marginfiAccount.address,
        authority: marginfiAccount.authority,
        group: marginfiAccount.group,
        driftMarketIndex: driftState.spotMarketState.marketIndex,
        driftOracle: driftState.spotMarketState.oracle,
        isSync: true,
        opts,
      });
    }
    case AssetTag.JUPLEND: {
      return makeJuplendDepositIx({
        program,
        bank,
        tokenProgram,
        amount: 1,
        accountAddress: marginfiAccount.address,
        authority: marginfiAccount.authority,
        group: marginfiAccount.group,
        isSync: true,
        opts,
      });
    }
    default: {
      return makeDepositIx({
        program,
        bank,
        tokenProgram,
        amount: 1,
        accountAddress: marginfiAccount.address,
        authority: marginfiAccount.authority,
        group: marginfiAccount.group,
        isSync: true,
        opts,
      });
    }
  }
}

async function buildWithdrawBudgetIx(
  config: FlashloanBudgetIx & { type: "withdraw" },
  program: MarginfiProgram,
  marginfiAccount: MarginfiAccountType,
  bankMap: Map<string, BankType>,
  bankMetadataMap: BankIntegrationMetadataMap,
  overrideInferAccounts?: { group?: PublicKey; authority?: PublicKey }
): Promise<InstructionsWrapper> {
  const { bank, tokenProgram } = config;
  const opts = { createAtas: false, wrapAndUnwrapSol: false, overrideInferAccounts };

  switch (bank.config.assetTag) {
    case AssetTag.KAMINO: {
      const reserve = bankMetadataMap[bank.address.toBase58()]?.kaminoStates?.reserveState;
      if (!reserve) {
        throw TransactionBuildingError.kaminoReserveNotFound(
          bank.address.toBase58(),
          bank.mint.toBase58(),
          bank.tokenSymbol
        );
      }
      return makeKaminoWithdrawIx({
        program,
        bank,
        bankMap,
        tokenProgram,
        cTokenAmount: 1,
        marginfiAccount,
        authority: marginfiAccount.authority,
        reserve,
        bankMetadataMap,
        withdrawAll: false,
        isSync: true,
        opts,
      });
    }
    case AssetTag.DRIFT: {
      const driftState = bankMetadataMap[bank.address.toBase58()]?.driftStates;
      if (!driftState) {
        throw TransactionBuildingError.driftStateNotFound(
          bank.address.toBase58(),
          bank.mint.toBase58(),
          bank.tokenSymbol
        );
      }
      return makeDriftWithdrawIx({
        program,
        bank,
        bankMap,
        tokenProgram,
        amount: 1,
        marginfiAccount,
        authority: marginfiAccount.authority,
        driftSpotMarket: driftState.spotMarketState,
        userRewards: driftState.userRewards,
        bankMetadataMap,
        withdrawAll: false,
        isSync: true,
        opts,
      });
    }
    case AssetTag.JUPLEND: {
      const jupLendState = bankMetadataMap[bank.address.toBase58()]?.jupLendStates;
      if (!jupLendState) {
        throw TransactionBuildingError.jupLendStateNotFound(
          bank.address.toBase58(),
          bank.mint.toBase58(),
          bank.tokenSymbol
        );
      }
      return makeJuplendWithdrawIx({
        program,
        bank,
        bankMap,
        tokenProgram,
        amount: 1,
        marginfiAccount,
        authority: marginfiAccount.authority,
        jupLendingState: jupLendState.jupLendingState,
        bankMetadataMap,
        withdrawAll: false,
        isSync: true,
        opts,
      });
    }
    default: {
      return makeWithdrawIx({
        program,
        bank,
        bankMap,
        tokenProgram,
        amount: 1,
        marginfiAccount,
        authority: marginfiAccount.authority,
        withdrawAll: false,
        bankMetadataMap,
        isSync: true,
        opts,
      });
    }
  }
}

/**
 * Compute flashloan swap constraints by building dummy primary + secondary IXs
 * and measuring the remaining TX budget. Replaces the duplicated switch/case
 * blocks in each action file.
 */
export async function computeFlashloanSwapConstraints({
  program,
  marginfiAccount,
  bankMap,
  addressLookupTableAccounts,
  bankMetadataMap,
  primaryIx,
  secondaryIx,
  overrideInferAccounts,
}: {
  program: MarginfiProgram;
  marginfiAccount: MarginfiAccountType;
  bankMap: Map<string, BankType>;
  addressLookupTableAccounts: AddressLookupTableAccount[];
  bankMetadataMap: BankIntegrationMetadataMap;
  primaryIx: FlashloanBudgetIx;
  secondaryIx: FlashloanBudgetIx;
  overrideInferAccounts?: { group?: PublicKey; authority?: PublicKey };
}): Promise<FlashloanSwapConstraints> {
  const cuRequestIxs = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: 1_200_000 }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1 }),
  ];

  const [primaryResult, secondaryResult] = await Promise.all([
    buildBudgetIx(
      primaryIx,
      program,
      marginfiAccount,
      bankMap,
      bankMetadataMap,
      overrideInferAccounts
    ),
    buildBudgetIx(
      secondaryIx,
      program,
      marginfiAccount,
      bankMap,
      bankMetadataMap,
      overrideInferAccounts
    ),
  ]);

  return computeFlashLoanNonSwapBudget({
    program,
    marginfiAccount,
    bankMap,
    addressLookupTableAccounts,
    ixs: [...cuRequestIxs, ...primaryResult.instructions, ...secondaryResult.instructions],
  });
}
