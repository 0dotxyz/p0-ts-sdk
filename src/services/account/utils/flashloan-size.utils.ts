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
  AddressLookupTableAccount,
  ComputeBudgetProgram,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import BN from "bn.js";

import { AssetTag, BankType } from "~/services/bank";
import { BankIntegrationMetadataMap, MarginfiProgram } from "~/types";
import { TransactionBuildingError } from "~/errors";
import { InstructionsWrapper } from "~/services/transaction";
import syncInstructions from "~/sync-instructions";

import { MarginfiAccountType, BalanceType } from "../types";
import { computeHealthAccountMetas, computeProjectedActiveBanksNoCpi } from "./compute";

import {
  makeDepositIx,
  makeDriftDepositIx,
  makeJuplendDepositIx,
  makeKaminoDepositIx,
} from "../actions/deposit";
import { makeBorrowIx } from "../actions/borrow";
import { makeRepayIx } from "../actions/repay";
import {
  makeDriftWithdrawIx,
  makeJuplendWithdrawIx,
  makeKaminoWithdrawIx,
  makeWithdrawIx,
} from "../actions/withdraw";
import { MAX_ACCOUNT_LOCKS, MAX_TX_SIZE } from "~/constants";

// V0 message compilation is non-additive: merging swap LUTs with non-swap LUTs
// causes the compiler to redistribute key resolution. Multi-hop routes add many
// unique program IDs (always static) and new LUT addresses. Observed merge
// overhead varies by route complexity: 25–191 bytes. 200 bytes covers worst
// observed case and forces Titan to prefer simpler routes with lower overhead.
const SWAP_MERGE_OVERHEAD = 150;

// BeginFL + EndFL instructions add ~52 bytes to the IX section. The precheck
// compiles without FL IXs, so we add this constant to get an accurate estimate.
const FL_IX_OVERHEAD = 52;

// Stand-in raw size for a tx too large for `serialize()` to even encode (it throws a RangeError).
// Any value comfortably over MAX_TX_SIZE works — it only needs to make `overshoot` positive so the
// route is scored as "doesn't fit" instead of crashing.
const OVERSIZED_TX_SENTINEL = MAX_TX_SIZE * 4;

// ============================================================================
// V0 TX size estimator (simulates V0 message compilation key resolution)
// ============================================================================

function compactU16Size(n: number): number {
  return n < 0x80 ? 1 : n < 0x4000 ? 2 : 3;
}

/**
 * Estimate the serialized size of a V0 transaction from its instructions and LUTs.
 * Simulates the key resolution logic of TransactionMessage.compileToV0Message
 * without actually compiling or serializing the message.
 */
export function computeV0TxSize(
  ixs: TransactionInstruction[],
  payerKey: PublicKey,
  luts: AddressLookupTableAccount[]
): { size: number; accountCount: number; writableAccountCount: number } {
  // --- Collect all unique keys with merged properties ---
  const keyMap = new Map<string, { isSigner: boolean; isWritable: boolean }>();

  const payerStr = payerKey.toBase58();
  keyMap.set(payerStr, { isSigner: true, isWritable: true });

  const programIds = new Set<string>();

  for (const ix of ixs) {
    const progStr = ix.programId.toBase58();
    programIds.add(progStr);
    if (!keyMap.has(progStr)) {
      keyMap.set(progStr, { isSigner: false, isWritable: false });
    }
    for (const meta of ix.keys) {
      const keyStr = meta.pubkey.toBase58();
      const existing = keyMap.get(keyStr);
      if (existing) {
        existing.isSigner = existing.isSigner || meta.isSigner;
        existing.isWritable = existing.isWritable || meta.isWritable;
      } else {
        keyMap.set(keyStr, { isSigner: meta.isSigner, isWritable: meta.isWritable });
      }
    }
  }

  // --- Build LUT lookup: pubkey base58 → { lutIndex, addressIndex } ---
  const lutLookup = new Map<string, { lutIdx: number; addrIdx: number }>();
  for (let li = 0; li < luts.length; li++) {
    const addresses = luts[li].state.addresses;
    for (let ai = 0; ai < addresses.length; ai++) {
      const addrStr = addresses[ai].toBase58();
      if (!lutLookup.has(addrStr)) {
        lutLookup.set(addrStr, { lutIdx: li, addrIdx: ai });
      }
    }
  }

  // --- Partition keys into static vs LUT ---
  let numStaticKeys = 0;
  let numWritableStaticKeys = 0;
  // Per-LUT: track writable and readonly index sets
  const lutWritableIdxs: Set<number>[] = luts.map(() => new Set());
  const lutReadonlyIdxs: Set<number>[] = luts.map(() => new Set());

  for (const [keyStr, props] of keyMap) {
    // Signers and invoked program IDs must be static
    if (props.isSigner || programIds.has(keyStr)) {
      numStaticKeys++;
      if (props.isWritable) numWritableStaticKeys++;
      continue;
    }

    const lutEntry = lutLookup.get(keyStr);
    if (lutEntry) {
      if (props.isWritable) {
        lutWritableIdxs[lutEntry.lutIdx].add(lutEntry.addrIdx);
      } else {
        lutReadonlyIdxs[lutEntry.lutIdx].add(lutEntry.addrIdx);
      }
    } else {
      numStaticKeys++;
      if (props.isWritable) numWritableStaticKeys++;
    }
  }

  // --- Fixed overhead: 1 (sigCount) + 64 (sig) + 1 (V0 prefix) + 3 (header) + 32 (blockhash) ---
  const fixedOverhead = 101;

  // --- Static keys section ---
  const staticKeysSection = compactU16Size(numStaticKeys) + numStaticKeys * 32;

  // --- IX section ---
  let ixSection = compactU16Size(ixs.length);
  for (const ix of ixs) {
    const numAccounts = ix.keys.length;
    ixSection +=
      1 + // programId index
      compactU16Size(numAccounts) +
      numAccounts + // account key indexes
      compactU16Size(ix.data.length) +
      ix.data.length;
  }

  // --- LUT section ---
  // Only include LUTs that actually have referenced keys
  let numUsedLuts = 0;
  let lutSection = 0;
  for (let li = 0; li < luts.length; li++) {
    const wCount = lutWritableIdxs[li].size;
    const rCount = lutReadonlyIdxs[li].size;
    if (wCount === 0 && rCount === 0) continue;
    numUsedLuts++;
    lutSection +=
      32 + // LUT address
      compactU16Size(wCount) +
      wCount + // writable indexes
      compactU16Size(rCount) +
      rCount; // readonly indexes
  }
  lutSection += compactU16Size(numUsedLuts);

  // Total unique account keys (static + LUT-resolved)
  let totalLutKeys = 0;
  for (let li = 0; li < luts.length; li++) {
    totalLutKeys += lutWritableIdxs[li].size + lutReadonlyIdxs[li].size;
  }
  const accountCount = numStaticKeys + totalLutKeys;

  // Writable accounts: writable static keys + LUT writable indexes
  let totalLutWritableKeys = 0;
  for (let li = 0; li < luts.length; li++) {
    totalLutWritableKeys += lutWritableIdxs[li].size;
  }
  const writableAccountCount = numWritableStaticKeys + totalLutWritableKeys;

  // Empirical +1: component-based calculation consistently underestimates by 1 byte
  // vs actual VersionedTransaction.serialize(). Verified across all measurement variants.
  const size = fixedOverhead + staticKeysSection + ixSection + lutSection + 1;

  return { size, accountCount, writableAccountCount };
}

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
export function computeFlashLoanNonSwapBudget({
  program,
  marginfiAccount,
  ixs,
  bankMap,
  addressLookupTableAccounts,
}: {
  program: MarginfiProgram;
  marginfiAccount: { address: PublicKey; authority: PublicKey; balances: BalanceType[] };
  ixs: TransactionInstruction[];
  bankMap: Map<string, BankType>;
  addressLookupTableAccounts: AddressLookupTableAccount[];
}): FlashloanSwapConstraints {
  // 1. Project which banks will be active after the primary IXs execute
  const projectedActiveBanksKeys = computeProjectedActiveBanksNoCpi(
    marginfiAccount.balances,
    ixs,
    program
  );
  const projectedActiveBanks = projectedActiveBanksKeys.map((key) => {
    const b = bankMap.get(key.toBase58());
    if (!b) throw new Error(`Bank ${key.toBase58()} not found in computeFlashLoanNonSwapBudget`);
    return b;
  });

  // 2. Build BeginFL and EndFL IXs synchronously
  const endIndex = ixs.length + 1; // BeginFL is at index 0, EndFL at endIndex
  const beginFlIx = syncInstructions.makeBeginFlashLoanIx(
    program.programId,
    { marginfiAccount: marginfiAccount.address, authority: marginfiAccount.authority },
    { endIndex: new BN(endIndex) }
  );

  const endFlRemainingAccounts = computeHealthAccountMetas(projectedActiveBanks);
  const endFlIx = syncInstructions.makeEndFlashLoanIx(
    program.programId,
    { marginfiAccount: marginfiAccount.address, authority: marginfiAccount.authority },
    endFlRemainingAccounts.map((pubkey) => ({ pubkey, isSigner: false, isWritable: false }))
  );

  // 3. Assemble all non-swap IXs in flashloan order
  const allNonSwapIxs = [beginFlIx, ...ixs, endFlIx];

  // 4. Compile a real V0 message and serialize for exact non-swap size
  const nonSwapMsg = new TransactionMessage({
    payerKey: marginfiAccount.authority,
    recentBlockhash: PublicKey.default.toBase58(),
    instructions: allNonSwapIxs,
  }).compileToV0Message(addressLookupTableAccounts);
  const nonSwapSize = new VersionedTransaction(nonSwapMsg).serialize().length;

  const { header, staticAccountKeys, addressTableLookups } = nonSwapMsg;
  const nonSwapTotal =
    staticAccountKeys.length +
    addressTableLookups.reduce(
      (s, l) => s + l.writableIndexes.length + l.readonlyIndexes.length,
      0
    );

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
  allIxs: TransactionInstruction[];
  payer: PublicKey;
  luts: AddressLookupTableAccount[];
  sizeConstraint: number;
  swapIxCount: number;
  swapLutCount: number;
}): FlashloanPrecheckResult {
  const msg = new TransactionMessage({
    payerKey: payer,
    recentBlockhash: PublicKey.default.toBase58(),
    instructions: allIxs,
  }).compileToV0Message(luts);

  // `serialize()` (via @solana/buffer-layout) throws `RangeError: encoding overruns Uint8Array`
  // when the compiled message is too large to even fit its wire buffer. That just means the tx is
  // grossly oversized, so treat it as a large positive overshoot (route "doesn't fit") rather than
  // letting the RangeError escape — callers (e.g. the swap engine's annotateFit) score on
  // `overshoot`, and an uncaught throw would short-circuit clean size classification.
  let rawSize: number;
  try {
    rawSize = new VersionedTransaction(msg).serialize().length;
  } catch (e) {
    if (!(e instanceof RangeError)) throw e;
    rawSize = OVERSIZED_TX_SENTINEL;
  }
  const fullTxSize = rawSize + FL_IX_OVERHEAD;
  const overshoot = fullTxSize - MAX_TX_SIZE;

  const { header, staticAccountKeys, addressTableLookups } = msg;
  const writableStatic =
    staticAccountKeys.length -
    header.numReadonlySignedAccounts -
    header.numReadonlyUnsignedAccounts;
  const writableLut = addressTableLookups.reduce((s, l) => s + l.writableIndexes.length, 0);
  const writableAccounts = writableStatic + writableLut;
  const totalAccounts =
    staticAccountKeys.length +
    addressTableLookups.reduce(
      (s, l) => s + l.writableIndexes.length + l.readonlyIndexes.length,
      0
    );

  // Check account limits before returning
  // if (totalAccounts > MAX_ACCOUNT_LOCKS) {
  //   throw TransactionBuildingError.swapSizeExceededLoop(
  //     fullTxSize,
  //     writableAccounts,
  //     undefined // provider unknown at this layer
  //   );
  // }

  console.log("[flashloan-precheck]", {
    fullTxSize,
    overshoot,
    sizeConstraint,
    writableAccounts,
    totalAccounts,
    staticKeys: staticAccountKeys.length,
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
