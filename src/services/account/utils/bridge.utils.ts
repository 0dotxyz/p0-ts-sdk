import { fetchEncodedAccount, type Address, type GetAccountInfoApi, type Rpc } from "@solana/kit";
import { TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";

import { MakeSwapDebtTxParams, MarginfiAccountType, SwapQuoteResult } from "../types";

import { USDC_MINT, USDT_MINT, WSOL_MINT } from "~/constants";
import { TransactionBuildingError } from "~/errors";
import { BankType } from "~/services/bank/types";
import {
  isStandardBorrowable,
  isStandardDepositable,
} from "~/services/bank/utils/capacity.utils";
import { SolanaTransaction } from "~/services/transaction";

/**
 * Shared support for the bridged (double-hop) one-call builders.
 *
 * A **bridge token** is NOT a cross-chain bridge: it is the high-liquidity intermediate token
 * (e.g. USDC or wSOL) a swap is routed *through*. When a direct collateral-swap / debt-swap /
 * loop `A → C` can't be built — the swap doesn't fit one tx (size / account-locks) or has no
 * route — it can still succeed decomposed into `A → bridge` + `bridge → C`, submitted as ONE
 * atomic Jito bundle. The per-flow builders live next to their direct builders
 * (`makeBridgedLoopTx` in `../actions/loop.ts`, `makeBridgedSwapCollateralTx` in
 * `../actions/swap-collateral.ts`, `makeBridgedSwapDebtTx` in `../actions/swap-debt.ts`); this
 * module owns the flow-agnostic routing support: candidate ordering/selection, the
 * candidate-iteration loop (abort / skip-on-failure / conflict surfacing), token-program
 * resolution, and the shared leg context.
 *
 * Candidate *ordering* is product policy: it defaults to {@link DEFAULT_BRIDGE_MINTS} and can be
 * overridden per call via {@link BridgeOpts.bridgeCandidateMints} (e.g. a correlation-aware
 * ordering). Candidate *filtering* (standard-bank resolution, opposite-side conflicts) is
 * mechanical and lives in {@link resolveBridgeCandidateBanks}.
 */

/**
 * The side of the marginfi account the bridge token sits on while the bridged bundle executes:
 * - `deposit` — the bridge token is held as *collateral* (a collateral-swap deposits it between
 *   the two legs: withdraw source → deposit bridge, then withdraw bridge → deposit destination).
 * - `borrow`  — the bridge token is held as *debt* (a debt-swap or loop borrows it in the first
 *   leg and repays it exactly in the second).
 */
export type BridgeTokenSide = "deposit" | "borrow";

/**
 * Whether routing through `bridgeBankPk` as the bridge token would conflict with a position the
 * account already holds on that bank. marginfi forbids holding an asset and a liability on the
 * same bank, so the conflict is always *opposite-side*: a deposit-side bridge conflicts with an
 * existing liability there, a borrow-side bridge with an existing asset. Same-side positions are
 * fine (partial-withdraw / exact-repay handle them).
 */
export function accountConflictsWithBridgeBank(
  marginfiAccount: MarginfiAccountType,
  bridgeBankPk: Address,
  bridgeTokenSide: BridgeTokenSide
): boolean {
  const balance = marginfiAccount.balances.find((b) => b.active && b.bankPk === bridgeBankPk);
  if (!balance) return false;
  return bridgeTokenSide === "deposit" ? balance.liabilityShares.gt(0) : balance.assetShares.gt(0);
}

export interface ResolveBridgeCandidateBanksParams {
  /** Candidate bridge-token mints, highest priority first; defaults to {@link DEFAULT_BRIDGE_MINTS}. */
  prioritizedBridgeCandidateMints: Address[];
  /** Banks to resolve the candidate mints against — typically all banks in the marginfi group. */
  groupBanks: BankType[];
  /** The account the bridged legs run against (for the conflict check). */
  marginfiAccount: MarginfiAccountType;
  /** Which side the bridge token is held on — picks the standard-bank filter and the conflict
   *  rule. */
  bridgeTokenSide: BridgeTokenSide;
}

/**
 * Resolve prioritized bridge-token candidate *mints* into candidate *banks*, partitioned into
 * those safe to route through and those blocked by an existing account position.
 *
 * For each mint (deduped, in priority order) it picks the standard bank that fits the side
 * ({@link isStandardBorrowable} for `borrow`, {@link isStandardDepositable} for `deposit`) — this
 * skips integration wrappers (`6200`) and `ReduceOnly` banks (`6017`) — then splits by
 * {@link accountConflictsWithBridgeBank}. The caller supplies the prioritized mint list (product
 * policy); this owns only the mechanical filtering.
 *
 * @returns `usableBridgeBanks` (safe to route through, in priority order) and
 *   `conflictingBridgeBanks` (resolvable but blocked by an opposite-side position — useful for
 *   surfacing a "close that position" message).
 */
export function resolveBridgeCandidateBanks(params: ResolveBridgeCandidateBanksParams): {
  usableBridgeBanks: BankType[];
  conflictingBridgeBanks: BankType[];
} {
  const { prioritizedBridgeCandidateMints, groupBanks, marginfiAccount, bridgeTokenSide } = params;
  const passesSideFilter =
    bridgeTokenSide === "borrow" ? isStandardBorrowable : isStandardDepositable;

  const usableBridgeBanks: BankType[] = [];
  const conflictingBridgeBanks: BankType[] = [];
  const seenMints = new Set<Address>();

  for (const mint of prioritizedBridgeCandidateMints) {
    if (seenMints.has(mint)) continue;
    seenMints.add(mint);

    const bank = groupBanks.find((b) => b.mint === mint && passesSideFilter(b));
    if (!bank) continue; // no standard bank for this mint on the required side

    if (accountConflictsWithBridgeBank(marginfiAccount, bank.address, bridgeTokenSide)) {
      conflictingBridgeBanks.push(bank);
    } else {
      usableBridgeBanks.push(bank);
    }
  }

  return { usableBridgeBanks, conflictingBridgeBanks };
}

/** Default bridge-token candidates, most-liquid first. */
export const DEFAULT_BRIDGE_MINTS: Address[] = [USDC_MINT, WSOL_MINT, USDT_MINT];

/** Per-call knobs for the bridged fallback of the `makeBridged*Tx` builders. */
export interface BridgeOpts {
  /**
   * Candidate bridge-token mints, highest priority first. Defaults to
   * {@link DEFAULT_BRIDGE_MINTS} (USDC, wSOL, USDT). Source/destination mints are always skipped.
   */
  bridgeCandidateMints?: Address[];
  /** Known token programs by mint — skips the per-mint RPC owner lookup. */
  tokenProgramByMint?: Map<string, Address>;
  /** Override the bundle-size ceiling (see `composeBridgedSwap`). */
  maxBundleTxs?: number;
  abortSignal?: AbortSignal;
}

/** Result of a `makeBridged*Tx` builder — the direct build's result, or the bridged bundle. */
export interface BridgedTxResult {
  transactions: SolanaTransaction[];
  /** Index of the tx that completes the action (the direct action tx, or the bundle's last leg). */
  actionTxIndex: number;
  quoteResponse: SwapQuoteResult | undefined;
  /** The bridge token's mint — set only when the bridged double-hop path was used. */
  bridgeMint?: Address;
  /** true → send as ONE atomic Jito bundle (bridged legs are one operation / integration
   *  refreshes go stale within a slot); false → sequential sends are safe (cranked oracles
   *  allow ≥ ~1 min staleness). */
  mustBeAtomicBundle: boolean;
}

/** A mint's token program: the cache (seedable by the caller), else the mint account's owner. */
export async function resolveTokenProgramForMint(
  mint: Address,
  rpc: Rpc<GetAccountInfoApi>,
  tokenProgramCacheByMint: Map<string, Address>
): Promise<Address> {
  const cached = tokenProgramCacheByMint.get(mint);
  if (cached) return cached;
  const account = await fetchEncodedAccount(rpc, mint);
  const owner = account.exists ? account.programAddress : TOKEN_PROGRAM_ADDRESS;
  tokenProgramCacheByMint.set(mint, owner);
  return owner;
}

/**
 * Bridge-token candidate banks for routing `source → bridge → destination`, in priority order,
 * partitioned into usable and conflict-blocked. Source/destination mints are excluded from the
 * candidates (a token can't bridge itself).
 */
export function selectSwapBridges(args: {
  sourceMint: Address;
  destinationMint: Address;
  bankMap: Map<string, BankType>;
  marginfiAccount: MarginfiAccountType;
  bridgeTokenSide: BridgeTokenSide;
  bridgeCandidateMints?: Address[];
}): { usableBridgeBanks: BankType[]; conflictingBridgeBanks: BankType[] } {
  const prioritizedCandidateMints = (args.bridgeCandidateMints ?? DEFAULT_BRIDGE_MINTS).filter(
    (mint) => mint !== args.sourceMint && mint !== args.destinationMint
  );
  return resolveBridgeCandidateBanks({
    prioritizedBridgeCandidateMints: prioritizedCandidateMints,
    groupBanks: [...args.bankMap.values()],
    marginfiAccount: args.marginfiAccount,
    bridgeTokenSide: args.bridgeTokenSide,
  });
}

function isAbortError(e: unknown): boolean {
  return e instanceof DOMException && e.name === "AbortError";
}

/**
 * Try each usable bridge-token candidate in priority order until one composes a bundle. A
 * `buildBundleThroughBridge` that returns null or throws (build failure) moves on to the next
 * candidate; abort errors always propagate. When NO candidate is usable but some were dropped
 * solely for an existing opposite-side position, throws
 * `TransactionBuildingError.bridgeConflict` (the caller-facing "close that position" signal);
 * otherwise resolves null and the caller rethrows the direct build's error.
 */
export async function tryBridgeCandidates(args: {
  usableBridgeBanks: BankType[];
  conflictingBridgeBanks: BankType[];
  bridgeTokenSide: BridgeTokenSide;
  abortSignal?: AbortSignal;
  /** Build the two-leg bundle through one candidate bank; null = didn't work, try the next. */
  buildBundleThroughBridge: (bridgeBank: BankType) => Promise<BridgedTxResult | null>;
}): Promise<BridgedTxResult | null> {
  for (const bridgeBank of args.usableBridgeBanks) {
    if (args.abortSignal?.aborted) {
      throw new DOMException("Operation was aborted", "AbortError");
    }
    try {
      const result = await args.buildBundleThroughBridge(bridgeBank);
      if (result) return result;
    } catch (e) {
      if (isAbortError(e)) throw e;
      // this bridge candidate failed to build a leg — try the next one
      console.warn(
        `[bridge-routing] candidate ${bridgeBank.tokenSymbol ?? bridgeBank.mint} failed:`,
        e instanceof Error ? e.message : e
      );
    }
  }
  if (args.usableBridgeBanks.length === 0 && args.conflictingBridgeBanks.length > 0) {
    throw TransactionBuildingError.bridgeConflict(
      args.conflictingBridgeBanks.map((bank) => ({
        bankAddress: bank.address,
        mint: bank.mint,
        symbol: bank.tokenSymbol,
      })),
      args.bridgeTokenSide
    );
  }
  return null;
}

/** The flow context shared verbatim by both legs of every bridged build. */
export type SharedBridgeLegContext = Pick<
  MakeSwapDebtTxParams,
  | "programAddress"
  | "marginfiAccount"
  | "authority"
  | "rpc"
  | "bankMap"
  | "bankMetadataMap"
  | "assetShareValueMultiplierByBank"
  | "swapOpts"
  | "luts"
  | "swapEngineRunner"
>;

export function sharedBridgeLegContext(params: SharedBridgeLegContext): SharedBridgeLegContext {
  return {
    programAddress: params.programAddress,
    marginfiAccount: params.marginfiAccount,
    authority: params.authority,
    rpc: params.rpc,
    bankMap: params.bankMap,
    bankMetadataMap: params.bankMetadataMap,
    assetShareValueMultiplierByBank: params.assetShareValueMultiplierByBank,
    swapOpts: params.swapOpts,
    luts: params.luts,
    swapEngineRunner: params.swapEngineRunner,
  };
}
