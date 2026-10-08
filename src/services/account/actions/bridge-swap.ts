import {
  getBase64Decoder,
  type Address,
  type BlockhashLifetimeConstraint,
  type Instruction,
  type TransactionSigner,
} from "@solana/kit";

import { SwapFlowTxParams, SwapFlowTxResult, SwapQuoteResult } from "../types";
import { computeProjectedActiveBalancesNoCpi } from "../utils";

import { USDC_MINT, USDT_MINT, WSOL_MINT } from "~/constants";
import { isDecomposableSwapError, TransactionBuildingError } from "~/errors";
import { BankType } from "~/services/bank/types";
import { isStandardBorrowable, isStandardDepositable } from "~/services/bank/utils/capacity.utils";
import { fetchProgramForMints } from "~/services/misc";
import {
  SolanaTransaction,
  splitInstructionsToFitTransactions,
  TransactionFormat,
  TransactionType,
} from "~/services/transaction";

/*
 * Bridged swaps
 *
 * When a swap A → C doesn't fit one transaction or has no route, it's split into two flashloan
 * legs through a liquid bridge token (e.g. USDC), sent as one atomic Jito bundle of at most 5 txs:
 *
 *                    open leg (creates the USDC position)   close leg (removes it)
 *   collateral swap  withdraw A, A → USDC, deposit USDC     withdraw USDC, USDC → C, deposit C
 *   debt swap        borrow USDC, USDC → A, repay A         borrow C, C → USDC, repay USDC
 *   loop             borrow USDC, USDC → P, deposit P       borrow X, X → USDC, repay USDC
 *
 * (A loop deposits P and borrows X.)
 *
 * Every bundle follows two rules:
 * - The close leg is built against the account as the open leg leaves it.
 * - Each leg's venue refreshes run right before its own flashloan, not together up front: the
 *   open leg changes venue state the close leg reads (a Kamino withdraw leaves its reserve stale).
 */

const MAX_BUNDLE_TXS = 5;

/** Default bridge mints, most liquid first. */
export const DEFAULT_BRIDGE_MINTS: Address[] = [USDC_MINT, WSOL_MINT, USDT_MINT];

/** Per-call options for the bridged fallback of the `makeBridged*Tx` builders. */
export interface BridgeOpts {
  /**
   * Bridge mints to try, highest priority first (default {@link DEFAULT_BRIDGE_MINTS}). The
   * swap's own mints are skipped.
   */
  bridgeCandidateMints?: Address[];
  /** Known token programs by mint; the others are read from chain. */
  tokenProgramByMint?: Map<string, Address>;
  abortSignal?: AbortSignal;
}

/**
 * Result of a `makeBridged*Tx` builder: the swap built without a bridge, or the bridged bundle,
 * whose `quoteResponse` is the swap into the bridge followed by the swap out of it and whose
 * `actionTxIndex` points at the close leg's flashloan.
 */
export interface BridgedTxResult extends SwapFlowTxResult {
  /** The bridge token's mint — set only when the bridged double-hop path was used. */
  bridgeMint?: Address;
}

/** A built leg of a bridged swap. */
export type BridgeLeg = Pick<BridgedTxResult, "transactions" | "actionTxIndex" | "quoteResponse">;

export interface MakeBridgedTxParams extends SwapFlowTxParams {
  /** Added to the open leg. */
  additionalIxs?: Instruction[];
  bridgeOpts?: BridgeOpts;
  /** Whether the bridge is held as collateral (collateral swap) or debt (debt swap, loop). */
  side: "deposit" | "borrow";
  sourceMint: Address;
  destinationMint: Address;
  /** Builds the swap without a bridge; tried first. */
  buildWithoutBridge: () => Promise<BridgedTxResult>;
  /**
   * Builds the leg that opens the bridge position, e.g. for a collateral swap A → C through USDC:
   * withdraw A, swap A → USDC, deposit USDC. null skips the bridge.
   */
  buildOpenBridgeLeg: (leg: {
    bridgeBank: BankType;
    bridgeTokenProgram: Address;
    context: SwapFlowTxParams & { additionalIxs?: Instruction[] };
  }) => Promise<BridgeLeg | null>;
  /**
   * Builds the leg that closes the bridge position, e.g. withdraw USDC, swap USDC → C, deposit C.
   * `context` holds the account as the open leg leaves it, and `openLegQuote` sizes what to
   * withdraw or repay. null skips the bridge.
   */
  buildCloseBridgeLeg: (leg: {
    bridgeBank: BankType;
    bridgeTokenProgram: Address;
    context: SwapFlowTxParams;
    openLegQuote: SwapQuoteResult;
  }) => Promise<BridgeLeg | null>;
}

/**
 * Returns `buildWithoutBridge`'s result, or when its swap doesn't fit one transaction or has no route,
 * the first bridge (in `bridgeOpts.bridgeCandidateMints` order) whose open and close legs fit one
 * bundle. A pinned route (`swapOpts.swapIxs`) is never split.
 * @throws `buildWithoutBridge`'s error when it can't be split or no bridge fits
 * @throws TransactionBuildingError (BRIDGE_CONFLICT) if every bridge is blocked by a position on
 * the opposite side of its bank
 */
export async function makeBridgedTx(params: MakeBridgedTxParams): Promise<BridgedTxResult> {
  try {
    // Try direct swap first
    return await params.buildWithoutBridge();
  } catch (error) {
    if (!isDecomposableSwapError(error) || params.swapOpts.swapIxs) throw error;
    // Try bridged swap
    const bridged = await findBridgedBundle(params);
    if (!bridged) throw error;
    return bridged;
  }
}

async function findBridgedBundle(params: MakeBridgedTxParams): Promise<BridgedTxResult | null> {
  const { side, bridgeOpts, marginfiAccount } = params;
  const isStandard = side === "deposit" ? isStandardDepositable : isStandardBorrowable;
  const usable: BankType[] = [];
  const conflicting: BankType[] = [];
  for (const mint of new Set(bridgeOpts?.bridgeCandidateMints ?? DEFAULT_BRIDGE_MINTS)) {
    if (mint === params.sourceMint || mint === params.destinationMint) continue;
    const bank = [...params.bankMap.values()].find((b) => b.mint === mint && isStandard(b));
    if (!bank) continue;
    // marginfi can't hold an asset and a liability in the same bank
    const balance = marginfiAccount.balances.find((b) => b.active && b.bankPk === bank.address);
    const conflicts =
      side === "deposit" ? balance?.liabilityShares.gt(0) : balance?.assetShares.gt(0);
    (conflicts ? conflicting : usable).push(bank);
  }

  if (usable.length === 0 && conflicting.length > 0) {
    throw TransactionBuildingError.bridgeConflict(
      conflicting.map((bank) => ({
        bankAddress: bank.address,
        mint: bank.mint,
        symbol: bank.tokenSymbol,
      })),
      side
    );
  }

  const tokenPrograms = new Map(bridgeOpts?.tokenProgramByMint);
  const unknownMints = usable.map((bank) => bank.mint).filter((mint) => !tokenPrograms.has(mint));
  if (unknownMints.length > 0) {
    for (const { mint, program } of await fetchProgramForMints(params.rpc, unknownMints)) {
      tokenPrograms.set(mint, program);
    }
  }

  for (const bank of usable) {
    if (bridgeOpts?.abortSignal?.aborted) {
      throw new DOMException("Operation was aborted", "AbortError");
    }
    const tokenProgram = tokenPrograms.get(bank.mint);
    if (!tokenProgram) continue;
    try {
      const bridged = await buildBridgedBundle(params, bank, tokenProgram);
      if (bridged) return bridged;
    } catch (error) {
      // A leg that can't be built through this bridge may still be through the next one
      if (!(error instanceof TransactionBuildingError)) throw error;
    }
  }
  return null;
}

async function buildBridgedBundle(
  params: MakeBridgedTxParams,
  bridgeBank: BankType,
  bridgeTokenProgram: Address
): Promise<BridgedTxResult | null> {
  const context: SwapFlowTxParams = {
    programAddress: params.programAddress,
    marginfiAccount: params.marginfiAccount,
    authority: params.authority,
    rpc: params.rpc,
    bankMap: params.bankMap,
    bankMetadataMap: params.bankMetadataMap,
    assetShareValueMultiplierByBank: params.assetShareValueMultiplierByBank,
    swapOpts: params.swapOpts,
    txFormat: params.txFormat,
    swapEngineRunner: params.swapEngineRunner,
  };
  const openLeg = await params.buildOpenBridgeLeg({
    bridgeBank,
    bridgeTokenProgram,
    context: { ...context, additionalIxs: params.additionalIxs },
  });
  if (!openLeg?.quoteResponse) return null;

  // A leg's transactions before `actionTxIndex` are its prelude: setups merge across both legs,
  // anything else stays right before the leg's own action
  const prelude = (leg: BridgeLeg) => leg.transactions.slice(0, leg.actionTxIndex);
  const action = (leg: BridgeLeg) => leg.transactions.slice(leg.actionTxIndex);
  const isSetup = (tx: SolanaTransaction) => tx.type === TransactionType.CREATE_ATA;

  const { projectedBalances } = computeProjectedActiveBalancesNoCpi({
    account: params.marginfiAccount,
    instructions: action(openLeg).flatMap((tx) => tx.message.instructions),
    programAddress: params.programAddress,
    banksMap: params.bankMap,
    assetShareValueMultiplierByBank: params.assetShareValueMultiplierByBank,
  });
  const closeLeg = await params.buildCloseBridgeLeg({
    bridgeBank,
    bridgeTokenProgram,
    context: {
      ...context,
      marginfiAccount: { ...params.marginfiAccount, balances: projectedBalances },
    },
    openLegQuote: openLeg.quoteResponse,
  });
  if (!closeLeg?.quoteResponse) return null;

  const transactions = [
    ...mergeSetups(
      [...prelude(openLeg), ...prelude(closeLeg)].filter(isSetup),
      params.authority,
      openLeg.transactions[0].message.lifetimeConstraint
    ),
    ...prelude(openLeg).filter((tx) => !isSetup(tx)),
    ...action(openLeg),
    ...prelude(closeLeg).filter((tx) => !isSetup(tx)),
    ...action(closeLeg),
  ];
  if (transactions.length > MAX_BUNDLE_TXS) return null;

  // A deposited bridge is swapped into by the open leg, a borrowed one by the close leg
  const [into, outOf] =
    params.side === "deposit"
      ? [openLeg.quoteResponse, closeLeg.quoteResponse]
      : [closeLeg.quoteResponse, openLeg.quoteResponse];
  return {
    transactions,
    actionTxIndex: transactions.length - 1,
    quoteResponse: {
      inAmount: into.inAmount,
      outAmount: outOf.outAmount,
      otherAmountThreshold: outOf.otherAmountThreshold,
      slippageBps: Math.round(
        (1 - (1 - into.slippageBps / 10_000) * (1 - outOf.slippageBps / 10_000)) * 10_000
      ),
      provider: into.provider,
    },
    bridgeMint: bridgeBank.mint,
    mustBeAtomicBundle: true,
  };
}

function mergeSetups(
  setups: SolanaTransaction[],
  feePayer: TransactionSigner,
  latestBlockhash: BlockhashLifetimeConstraint
): SolanaTransaction[] {
  if (setups.length <= 1) return setups;

  // Both legs create the bridge ATA
  const seen = new Set<string>();
  const instructions = setups
    .flatMap((tx) => tx.message.instructions)
    .filter((ix) => {
      const id = [
        ix.programAddress,
        ...(ix.accounts ?? []).map((account) => account.address),
        getBase64Decoder().decode(ix.data ?? new Uint8Array()),
      ].join("|");
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });

  // A version 0 leg's instructions keep their lookup-table accounts, which version 1 can't encode
  const txFormat: TransactionFormat = setups.every((tx) => tx.message.version === 1)
    ? { version: 1 }
    : { version: 0, luts: {} };
  return splitInstructionsToFitTransactions([], instructions, {
    latestBlockhash,
    feePayer,
    txFormat,
  }).map((message) => ({ message, type: TransactionType.CREATE_ATA }));
}
