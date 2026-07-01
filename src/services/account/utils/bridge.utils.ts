import { PublicKey } from "@solana/web3.js";

import { BankType, isStandardBorrowable, isStandardDepositable } from "~/services/bank";

import { MarginfiAccountType } from "../types";

/**
 * Which side of a bridged (double-hop) swap touches the bridge token:
 * - `deposit` — the bridge is *deposited* (e.g. collateral-swap: source → bridge → dest).
 * - `borrow`  — the bridge is *borrowed* (e.g. debt-swap / loop: borrow bridge, then repay it).
 */
export type BridgeSide = "deposit" | "borrow";

/**
 * Whether routing through `bankPk` as the bridge would conflict with an existing position on the
 * account. marginfi forbids holding an asset and a liability on the same bank, so the conflict is
 * always *opposite-side*: a deposit-side bridge conflicts with an existing liability there, a
 * borrow-side bridge with an existing asset. Same-side positions are fine (partial-withdraw /
 * exact-repay handle them).
 */
export function accountConflictsWithBridge(
  account: MarginfiAccountType,
  bankPk: PublicKey,
  side: BridgeSide
): boolean {
  const balance = account.balances.find((b) => b.active && b.bankPk.equals(bankPk));
  if (!balance) return false;
  return side === "deposit" ? balance.liabilityShares.gt(0) : balance.assetShares.gt(0);
}

export interface ResolveBridgeBanksParams {
  /** Candidate bridge mints in priority order (caller-owned product policy). */
  orderedBridgeMints: PublicKey[];
  /** Banks to resolve mints against (e.g. all of the group's banks). */
  banks: BankType[];
  /** The account the bridge legs run against (for the conflict check). */
  marginfiAccount: MarginfiAccountType;
  /** Which side the bridge is used on — picks the standard-bank filter and the conflict rule. */
  side: BridgeSide;
}

/**
 * Resolve an ordered list of candidate bridge *mints* into usable bridge *banks*, partitioned into
 * those safe to route through and those that conflict with an existing position.
 *
 * For each mint (deduped, in priority order) it picks the standard bank that fits the side
 * ({@link isStandardBorrowable} for `borrow`, {@link isStandardDepositable} for `deposit`) — this
 * skips integration wrappers (`6200`) and `ReduceOnly` banks (`6017`) — then splits by
 * {@link accountConflictsWithBridge}. The caller supplies the ordered mint list (product policy);
 * this owns only the mechanical filtering.
 *
 * @returns `bridges` (usable, in priority order) and `conflicts` (resolvable but blocked by an
 *   opposite-side position — useful for surfacing a "close that position" message).
 */
export function resolveBridgeBanks(params: ResolveBridgeBanksParams): {
  bridges: BankType[];
  conflicts: BankType[];
} {
  const { orderedBridgeMints, banks, marginfiAccount, side } = params;
  const passesSideFilter = side === "borrow" ? isStandardBorrowable : isStandardDepositable;

  const bridges: BankType[] = [];
  const conflicts: BankType[] = [];
  const seenMints = new Set<string>();

  for (const mint of orderedBridgeMints) {
    const mintKey = mint.toBase58();
    if (seenMints.has(mintKey)) continue;
    seenMints.add(mintKey);

    const bank = banks.find((b) => b.mint.equals(mint) && passesSideFilter(b));
    if (!bank) continue; // no standard bank for this mint on the required side

    if (accountConflictsWithBridge(marginfiAccount, bank.address, side)) {
      conflicts.push(bank);
    } else {
      bridges.push(bank);
    }
  }

  return { bridges, conflicts };
}
