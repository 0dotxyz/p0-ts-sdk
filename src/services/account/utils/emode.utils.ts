import type { Address } from "@solana/kit";
import { BigNumber } from "bignumber.js";

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

    // A liability bank's entries apply whatever its own tag
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
      const existing = result.get(collateralBankPk);

      if (!existing) {
        result.set(collateralBankPk, {
          assetWeightInit: emodePair.assetWeightInit,
          assetWeightMaint: emodePair.assetWeightMaint,
        });
      } else {
        result.set(collateralBankPk, {
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
  let bestPair = pairs[0];
  for (const p of pairs) {
    if (p.assetWeightInit.lt(bestPair.assetWeightInit)) {
      bestPair = p;
    }
  }

  // Aggregate all banks and tags from all pairs
  return {
    collateralBanks: Array.from(new Set(pairs.map((p) => p.collateralBanks).flat())),
    collateralBankTags: Array.from(new Set(pairs.map((p) => p.collateralBankTag).flat())),
    liabilityBanks: Array.from(new Set(pairs.map((p) => p.liabilityBank))),
    liabilityBankTags: Array.from(new Set(pairs.map((p) => p.liabilityBankTag).flat())),
    assetWeightMaint: bestPair.assetWeightMaint,
    assetWeightInit: bestPair.assetWeightInit,
  };
}

// Emode pairs whose collateral tag is set, indexed once per `computeEmodeImpacts` run
type IndexedEmodePair = {
  orig: EmodePair;
  liabStr: string;
  collTagStr: string;
  collStrs: string[];
};

function indexConfiguredPairs(emodePairs: EmodePair[]): IndexedEmodePair[] {
  return emodePairs
    .filter((p) => p.collateralBankTag !== EmodeTag.UNSET)
    .map((p) => ({
      orig: p,
      liabStr: p.liabilityBank,
      collTagStr: p.collateralBankTag.toString(),
      collStrs: p.collateralBanks,
    }));
}

function activePairsFromIndex(
  configured: IndexedEmodePair[],
  liabSet: Set<string>,
  collSet: Set<string>
): EmodePair[] {
  // Keep configured pairs touching both an active liability AND collateral.
  const possible = configured.filter(
    (p) => liabSet.has(p.liabStr) && p.collStrs.some((c) => collSet.has(c))
  );

  // Group by collateral-tag.
  const byCollTag: Record<string, IndexedEmodePair[]> = {};
  for (const p of possible) {
    (byCollTag[p.collTagStr] ||= []).push(p);
  }

  // The program (`reconcile_emode_configs`) applies a collateral tag only if every liability
  // bank's own config has an entry for it
  return Object.values(byCollTag)
    .filter((group) => [...liabSet].every((liab) => group.some((p) => p.liabStr === liab)))
    .flat()
    .map((p) => p.orig);
}

export function computeEmodeImpacts(
  emodePairs: EmodePair[],
  activeLiabilities: Address[],
  activeCollateral: Address[],
  allBanks: Address[]
): Record<string, ActionEmodeImpact> {
  // Run all membership/grouping on address Sets/Maps.
  const activeLiabilitiesSet = new Set(activeLiabilities);
  const activeCollateralSet = new Set(activeCollateral);

  const configured = indexConfiguredPairs(emodePairs);

  // Every collateral bank referenced by any pair (supply-eligibility check).
  const allCollateralBankStrs = new Set<string>();
  for (const p of emodePairs) {
    for (const c of p.collateralBanks) allCollateralBankStrs.add(c);
  }

  // Baseline state
  const basePairs = activePairsFromIndex(configured, activeLiabilitiesSet, activeCollateralSet);
  const baseOn = basePairs.length > 0;

  // Compared per held collateral bank: a borrow can lower one bank's weight while the lowest
  // weight stays put
  function diffState(
    before: EmodePair[],
    after: EmodePair[],
    collateral: Set<string>
  ): EmodeImpactStatus {
    const was = before.length > 0,
      isOn = after.length > 0;
    if (!was && !isOn) return EmodeImpactStatus.InactiveEmode;
    if (!was && isOn) return EmodeImpactStatus.ActivateEmode;
    if (was && !isOn) return EmodeImpactStatus.RemoveEmode;

    const beforeWeights = computeLowestEmodeWeights(before);
    const afterWeights = computeLowestEmodeWeights(after);
    let increased = false;
    for (const bank of collateral) {
      const b = beforeWeights.get(bank)?.assetWeightInit ?? new BigNumber(0);
      const a = afterWeights.get(bank)?.assetWeightInit ?? new BigNumber(0);
      if (a.lt(b)) return EmodeImpactStatus.ReduceEmode;
      if (a.gt(b)) increased = true;
    }
    return increased ? EmodeImpactStatus.IncreaseEmode : EmodeImpactStatus.ExtendEmode;
  }

  // Simulation of each action
  function simulate(
    bankStr: Address,
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

    const after = activePairsFromIndex(configured, L, C);
    let status = diffState(basePairs, after, C);

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
  for (const key of allBanks) {
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
  activeLiabilities: Address[],
  activeCollateral: Address[]
): EmodePair[] {
  return activePairsFromIndex(
    indexConfiguredPairs(emodePairs),
    new Set(activeLiabilities),
    new Set(activeCollateral)
  );
}
