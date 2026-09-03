import { PublicKey } from "@solana/web3.js";

import { MarginfiAccountType } from "../types";

import { BankType, isStandardBorrowable, isStandardDepositable } from "~/services/bank";


/**
 * Bridge-token candidate filtering for bridged (double-hop) swaps.
 *
 * A **bridge token** is NOT a cross-chain bridge: it is the high-liquidity intermediate token
 * (e.g. USDC or wSOL) that a swap `A → C` is routed *through* — as `A → bridge` + `bridge → C` in
 * one atomic bundle — when the direct swap can't fit a single transaction or has no route. This
 * module owns the mechanical filtering of bridge-token candidates; ordering (product policy) and
 * the one-call builders live in `bridge-routing.utils.ts` and the `makeBridged*Tx` actions.
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
  bridgeBankPk: PublicKey,
  bridgeTokenSide: BridgeTokenSide
): boolean {
  const balance = marginfiAccount.balances.find((b) => b.active && b.bankPk.equals(bridgeBankPk));
  if (!balance) return false;
  return bridgeTokenSide === "deposit" ? balance.liabilityShares.gt(0) : balance.assetShares.gt(0);
}

export interface ResolveBridgeCandidateBanksParams {
  /** Candidate bridge-token mints, highest priority first (product policy — see
   *  `bridge-routing.utils.ts` for the default ordering and the per-call override). */
  prioritizedBridgeCandidateMints: PublicKey[];
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
  const seenMints = new Set<string>();

  for (const mint of prioritizedBridgeCandidateMints) {
    const mintKey = mint.toBase58();
    if (seenMints.has(mintKey)) continue;
    seenMints.add(mintKey);

    const bank = groupBanks.find((b) => b.mint.equals(mint) && passesSideFilter(b));
    if (!bank) continue; // no standard bank for this mint on the required side

    if (accountConflictsWithBridgeBank(marginfiAccount, bank.address, bridgeTokenSide)) {
      conflictingBridgeBanks.push(bank);
    } else {
      usableBridgeBanks.push(bank);
    }
  }

  return { usableBridgeBanks, conflictingBridgeBanks };
}
