import { PublicKey } from "@solana/web3.js";
import BigNumber from "bignumber.js";

import {
  ActionEmodeImpact,
  ActiveEmodePair,
  BankType,
  EmodeImpact,
  EmodeImpactStatus,
  EmodePair,
  EmodeTag,
} from "~/services/bank/types";

/**
 * Generates emode pairs from an array of banks by analyzing their emode configurations.
 * @param banks - Array of banks to analyze for emode relationships
 * @returns Array of emode pairs defining relationships between liability and collateral banks
 */
export function getEmodePairs(banks: BankType[]): EmodePair[] {
  const emodePairs: EmodePair[] = [];

  banks.forEach((bank) => {
    const emodeTag = bank.emode.emodeTag;

    if (emodeTag === EmodeTag.UNSET) {
      return;
    }

    bank.emode.emodeEntries.forEach((emodeEntry) => {
      emodePairs.push({
        collateralBanks: banks
          .filter((b) => b.emode.emodeTag === emodeEntry.collateralBankEmodeTag)
          .map((b) => b.address),
        collateralBankTag: emodeEntry.collateralBankEmodeTag,
        liabilityBank: bank.address,
        liabilityBankTag: emodeTag,
        assetWeightMaint: emodeEntry.assetWeightMaint,
        assetWeightInit: emodeEntry.assetWeightInit,
      });
    });
  });

  return emodePairs;
}

/**
 * Computes the lowest emode weights for each collateral bank across all active emode pairs.
 * Returns a Map keyed by bank address string for consistency with other SDK maps.
 *
 * @param emodePairs - Array of emode pairs to analyze
 * @returns Map of bank address → lowest { assetWeightInit, assetWeightMaint }
 */
export function computeLowestEmodeWeights(
  emodePairs: EmodePair[]
): Map<string, { assetWeightInit: BigNumber; assetWeightMaint: BigNumber }> {
  const result = new Map<string, { assetWeightInit: BigNumber; assetWeightMaint: BigNumber }>();

  emodePairs.forEach((emodePair) => {
    emodePair.collateralBanks.forEach((collateralBankPk) => {
      const bankPkStr = collateralBankPk.toBase58();
      const existing = result.get(bankPkStr);

      if (!existing) {
        result.set(bankPkStr, {
          assetWeightInit: emodePair.assetWeightInit,
          assetWeightMaint: emodePair.assetWeightMaint,
        });
      } else {
        result.set(bankPkStr, {
          assetWeightInit: BigNumber.min(existing.assetWeightInit, emodePair.assetWeightInit),
          assetWeightMaint: BigNumber.min(existing.assetWeightMaint, emodePair.assetWeightMaint),
        });
      }
    });
  });

  return result;
}

/**
 * Creates an ActiveEmodePair from a list of active EmodePairs.
 * Selects the pair with the lowest assetWeightInit and aggregates all banks and tags.
 */
export function createActiveEmodePairFromPairs(pairs: EmodePair[]): ActiveEmodePair | undefined {
  if (pairs.length === 0) {
    return undefined;
  }

  // Find the pair with lowest assetWeightInit
  let bestPair = pairs[0]!;
  for (const p of pairs) {
    if (p.assetWeightInit.lt(bestPair.assetWeightInit)) {
      bestPair = p;
    }
  }

  // Aggregate all banks and tags from all pairs
  return {
    collateralBanks: Array.from(
      new Map(
        pairs
          .map((p) => p.collateralBanks)
          .flat()
          .map((bank) => [bank.toBase58(), bank])
      ).values()
    ),
    collateralBankTags: Array.from(new Set(pairs.map((p) => p.collateralBankTag).flat())),
    liabilityBanks: Array.from(
      new Map(
        pairs
          .map((p) => p.liabilityBank)
          .flat()
          .map((bank) => [bank.toBase58(), bank])
      ).values()
    ),
    liabilityBankTags: Array.from(new Set(pairs.map((p) => p.liabilityBankTag).flat())),
    assetWeightMaint: bestPair.assetWeightMaint,
    assetWeightInit: bestPair.assetWeightInit,
  };
}

/**
 * A configured emode pair with its banks/tags pre-stringified, plus a reference
 * back to the original `EmodePair`. The hot paths below compare/group on these
 * base58 strings (O(1) Set/Map lookups) instead of `PublicKey.equals` /
 * `.toBase58()` (32-byte compares + base58 encodes), then return `orig` so
 * callers still receive the original `EmodePair` objects.
 */
type IndexedEmodePair = {
  orig: EmodePair;
  liabStr: string;
  liabTagStr: string;
  collTagStr: string;
  collStrs: string[];
};

/**
 * Indexes the *configured* emode pairs (both tags set) once. `emodePairs` is
 * constant across a whole `computeEmodeImpacts` run, so this is hoisted out of
 * the per-bank/per-action simulation loop instead of being rebuilt ~800x.
 */
function indexConfiguredPairs(emodePairs: EmodePair[]): {
  configured: IndexedEmodePair[];
  liabTagByBank: Map<string, string>;
} {
  const configured: IndexedEmodePair[] = [];
  const liabTagByBank = new Map<string, string>();
  for (const p of emodePairs) {
    if (p.collateralBankTag === EmodeTag.UNSET || p.liabilityBankTag === EmodeTag.UNSET) {
      continue;
    }
    const liabStr = p.liabilityBank.toBase58();
    const liabTagStr = p.liabilityBankTag.toString();
    configured.push({
      orig: p,
      liabStr,
      liabTagStr,
      collTagStr: p.collateralBankTag.toString(),
      collStrs: p.collateralBanks.map((b) => b.toBase58()),
    });
    liabTagByBank.set(liabStr, liabTagStr);
  }
  return { configured, liabTagByBank };
}

/**
 * String-keyed core of {@link computeActiveEmodePairs}. Operates purely on the
 * pre-built index + base58 Sets — no PublicKey ops. Returns the original
 * `EmodePair` objects (same order and references as the legacy implementation).
 */
function activePairsFromIndex(
  configured: IndexedEmodePair[],
  liabTagByBank: Map<string, string>,
  liabSet: Set<string>,
  collSet: Set<string>
): EmodePair[] {
  // Required liability-tags from all active liabilities. A liability with no
  // configured entry kills EMODE immediately.
  const requiredTags = new Set<string>();
  for (const liab of liabSet) {
    const tag = liabTagByBank.get(liab);
    if (!tag) return [];
    requiredTags.add(tag);
  }

  // Keep configured pairs touching both an active liability AND collateral.
  const possible = configured.filter(
    (p) => liabSet.has(p.liabStr) && p.collStrs.some((c) => collSet.has(c))
  );
  if (possible.length === 0) return [];

  // Group by collateral-tag.
  const byCollTag: Record<string, IndexedEmodePair[]> = {};
  for (const p of possible) {
    (byCollTag[p.collTagStr] ||= []).push(p);
  }

  // Keep groups whose liability-tags cover every required tag.
  const validGroups: IndexedEmodePair[][] = [];
  for (const group of Object.values(byCollTag)) {
    const supports = new Set(group.map((p) => p.liabTagStr));
    let coversAll = true;
    for (const rt of requiredTags) {
      if (!supports.has(rt)) {
        coversAll = false;
        break;
      }
    }
    if (coversAll) validGroups.push(group);
  }
  if (validGroups.length === 0) return [];

  return validGroups.flat().map((p) => p.orig);
}

export function computeEmodeImpacts(
  emodePairs: EmodePair[],
  activeLiabilities: PublicKey[],
  activeCollateral: PublicKey[],
  allBanks: PublicKey[]
): Record<string, ActionEmodeImpact> {
  // Convert everything to base58 strings ONCE up front and run all
  // membership/grouping on string Sets/Maps.
  const activeLiabilitiesSet = new Set(activeLiabilities.map((b) => b.toBase58()));
  const activeCollateralSet = new Set(activeCollateral.map((b) => b.toBase58()));

  // Index of configured pairs — hoisted out of the simulation loop.
  const { configured, liabTagByBank } = indexConfiguredPairs(emodePairs);

  // Liability-tag map over ALL pairs (incl. unconfigured). Intentionally broader
  // than the configured map above: used by the borrow override and `existingTags`.
  const liabTagMapAll = new Map<string, string>();
  for (const p of emodePairs) {
    liabTagMapAll.set(p.liabilityBank.toBase58(), p.liabilityBankTag.toString());
  }

  // Every collateral bank referenced by any pair (supply-eligibility check).
  const allCollateralBankStrs = new Set<string>();
  for (const p of emodePairs) {
    for (const c of p.collateralBanks) allCollateralBankStrs.add(c.toBase58());
  }

  // Baseline state
  const basePairs = activePairsFromIndex(
    configured,
    liabTagByBank,
    activeLiabilitiesSet,
    activeCollateralSet
  );
  const baseOn = basePairs.length > 0;

  const existingTags = new Set<string>(
    Array.from(activeLiabilitiesSet)
      .map((l) => liabTagMapAll.get(l))
      .filter((t): t is string => !!t)
  );

  // Helper for min initial weight (used in diffState only)
  function minWeight(ps: EmodePair[]): BigNumber {
    // TODO: handle empty array
    let m = ps[0]!.assetWeightInit;
    for (const x of ps) if (x.assetWeightInit.lt(m)) m = x.assetWeightInit;
    return m;
  }

  // Determine status transitions
  function diffState(before: EmodePair[], after: EmodePair[]): EmodeImpactStatus {
    const was = before.length > 0,
      isOn = after.length > 0;
    if (!was && !isOn) return EmodeImpactStatus.InactiveEmode;
    if (!was && isOn) return EmodeImpactStatus.ActivateEmode;
    if (was && !isOn) return EmodeImpactStatus.RemoveEmode;

    const bMin = minWeight(before),
      aMin = minWeight(after);
    if (aMin.gt(bMin)) return EmodeImpactStatus.IncreaseEmode;
    if (aMin.lt(bMin)) return EmodeImpactStatus.ReduceEmode;
    return EmodeImpactStatus.ExtendEmode;
  }

  // Simulation of each action
  function simulate(
    bankStr: string,
    action: "borrow" | "repay" | "supply" | "withdraw"
  ): EmodeImpact {
    const L = new Set(activeLiabilitiesSet),
      C = new Set(activeCollateralSet);
    switch (action) {
      case "borrow":
        L.add(bankStr);
        break;
      case "repay":
        L.delete(bankStr);
        break;
      case "supply":
        C.add(bankStr);
        break;
      case "withdraw":
        C.delete(bankStr);
        break;
    }

    const after = activePairsFromIndex(configured, liabTagByBank, L, C);
    let status = diffState(basePairs, after);

    // Borrow override
    if (action === "borrow") {
      const tag = liabTagMapAll.get(bankStr);

      // Borrowing an unconfigured bank => EMODE off / inactive
      if (!tag) {
        status = baseOn ? EmodeImpactStatus.RemoveEmode : EmodeImpactStatus.InactiveEmode;

        // EMODE was ON; keep the diffState result unless EMODE really turns OFF
      } else if (baseOn) {
        if (after.length === 0) {
          status = EmodeImpactStatus.RemoveEmode;
        } else if (existingTags.has(tag)) {
          status = EmodeImpactStatus.ExtendEmode; // same tag ⇒ extend
          // else keep diffState (Increase/Reduce) which is already correct
        }
      }
    }

    // Supply override
    if (action === "supply") {
      const isOn = after.length > 0;
      status =
        !baseOn && isOn
          ? EmodeImpactStatus.ActivateEmode
          : baseOn && isOn
            ? EmodeImpactStatus.ExtendEmode
            : EmodeImpactStatus.InactiveEmode;
    }

    // Withdraw override
    if (action === "withdraw") {
      if (!baseOn) {
        status = EmodeImpactStatus.InactiveEmode;
      } else if (after.length === 0) {
        status = EmodeImpactStatus.RemoveEmode;
      } else {
        const b = minWeight(basePairs),
          a = minWeight(after);
        if (a.gt(b)) status = EmodeImpactStatus.IncreaseEmode;
        else if (a.lt(b)) status = EmodeImpactStatus.ReduceEmode;
        else status = EmodeImpactStatus.ExtendEmode;
      }
    }

    // Create active emode pair from resulting pairs
    const activeEmodePair = createActiveEmodePairFromPairs(after);

    return {
      status,
      resultingPairs: after,
      activePair: activeEmodePair,
    };
  }

  // Run simulations across allBanks
  const result: Record<string, ActionEmodeImpact> = {};
  for (const bank of allBanks) {
    const key = bank.toBase58();
    const impact: ActionEmodeImpact = {};

    // Only new borrows (bank not already collateral)
    if (!activeCollateralSet.has(key)) {
      impact.borrowImpact = simulate(key, "borrow");
    }

    // Only supply for collateral-configured banks not in play
    if (
      allCollateralBankStrs.has(key) &&
      !activeCollateralSet.has(key) &&
      !activeLiabilitiesSet.has(key)
    ) {
      impact.supplyImpact = simulate(key, "supply");
    }

    if (activeLiabilitiesSet.has(key)) {
      impact.repayAllImpact = simulate(key, "repay");
    }
    if (activeCollateralSet.has(key)) {
      impact.withdrawAllImpact = simulate(key, "withdraw");
    }

    result[key] = impact;
  }

  return result;
}

export function computeActiveEmodePairs(
  emodePairs: EmodePair[],
  activeLiabilities: PublicKey[],
  activeCollateral: PublicKey[]
): EmodePair[] {
  // Public PublicKey-based API preserved for callers (action-box simulations,
  // account model). Converts to base58 once and delegates to the string-keyed
  // core — drops the O(pairs × actives) PublicKey.equals/.toBase58 work.
  const { configured, liabTagByBank } = indexConfiguredPairs(emodePairs);
  const liabSet = new Set(activeLiabilities.map((b) => b.toBase58()));
  const collSet = new Set(activeCollateral.map((b) => b.toBase58()));
  return activePairsFromIndex(configured, liabTagByBank, liabSet, collSet);
}
