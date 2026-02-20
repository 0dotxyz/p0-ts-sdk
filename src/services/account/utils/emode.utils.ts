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

export function computeEmodeImpacts(
  emodePairs: EmodePair[],
  activeLiabilities: PublicKey[],
  activeCollateral: PublicKey[],
  allBanks: PublicKey[]
): Record<string, ActionEmodeImpact> {
  const toKey = (k: PublicKey) => k.toBase58();

  // Baseline state
  const basePairs = computeActiveEmodePairs(emodePairs, activeLiabilities, activeCollateral);
  const baseOn = basePairs.length > 0;

  // Liability tag map & existing tags
  const liabTagMap = new Map<string, string>();
  for (const p of emodePairs) {
    liabTagMap.set(p.liabilityBank.toBase58(), p.liabilityBankTag.toString());
  }
  const existingTags = new Set<string>(
    activeLiabilities.map((l) => liabTagMap.get(l.toBase58())).filter((t): t is string => !!t)
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
    bank: PublicKey,
    action: "borrow" | "repay" | "supply" | "withdraw"
  ): EmodeImpact {
    const isSolBank = bank.equals(new PublicKey("CCKtUs6Cgwo4aaQUmBPmyoApH2gUDErxNZCAntD6LYGh"));

    let L = [...activeLiabilities],
      C = [...activeCollateral];
    switch (action) {
      case "borrow":
        if (!L.some((x) => x.equals(bank))) L.push(bank);
        break;
      case "repay":
        L = L.filter((x) => !x.equals(bank));
        break;
      case "supply":
        if (!C.some((x) => x.equals(bank))) C.push(bank);
        break;
      case "withdraw":
        C = C.filter((x) => !x.equals(bank));
        break;
    }

    const after = computeActiveEmodePairs(emodePairs, L, C);
    let status = diffState(basePairs, after);

    // Borrow override
    if (action === "borrow") {
      const tag = liabTagMap.get(bank.toBase58());

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
    const key = toKey(bank);
    const impact: ActionEmodeImpact = {};

    // Only new borrows
    if (!activeCollateral.some((x) => x.equals(bank))) {
      impact.borrowImpact = simulate(bank, "borrow");
    }

    // Only supply for collateral-configured banks not in play
    const collSet = new Set(emodePairs.flatMap((p) => p.collateralBanks.map((c) => c.toBase58())));
    if (
      collSet.has(key) &&
      !activeCollateral.some((x) => x.equals(bank)) &&
      !activeLiabilities.some((x) => x.equals(bank))
    ) {
      impact.supplyImpact = simulate(bank, "supply");
    }

    if (activeLiabilities.some((x) => x.equals(bank))) {
      impact.repayAllImpact = simulate(bank, "repay");
    }
    if (activeCollateral.some((x) => x.equals(bank))) {
      impact.withdrawAllImpact = simulate(bank, "withdraw");
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
  // 1) Drop any pairs with an “unset” tag (0)
  const configured = emodePairs.filter(
    (p) => p.collateralBankTag !== EmodeTag.UNSET && p.liabilityBankTag !== EmodeTag.UNSET
  );

  // 2) Build the set of required liability‐tags from _all_ active liabilities
  //    If any liability has no configured entry at all, EMODE is off.
  const liabTagByBank = new Map<string, string>();
  for (const p of configured) {
    liabTagByBank.set(p.liabilityBank.toBase58(), p.liabilityBankTag.toString());
  }
  const requiredTags = new Set<string>();
  for (const liab of activeLiabilities) {
    const tag = liabTagByBank.get(liab.toBase58());
    if (!tag) {
      // a liability with no entries kills EMODE immediately
      return [];
    }
    requiredTags.add(tag);
  }

  // 3) Of those configured pairs, keep only ones touching both an active liability AND collateral
  const possible = configured.filter(
    (p) =>
      activeLiabilities.some((l) => l.equals(p.liabilityBank)) &&
      p.collateralBanks.some((c) => activeCollateral.some((a) => a.equals(c)))
  );
  if (possible.length === 0) return [];

  // 4) Group by collateral-tag
  const byCollTag: Record<string, EmodePair[]> = {};
  for (const p of possible) {
    const ct = p.collateralBankTag.toString();
    (byCollTag[ct] ||= []).push(p);
  }

  // 5) Find all groups whose liability-tags cover _every_ requiredTag
  const validGroups: EmodePair[][] = [];
  for (const group of Object.values(byCollTag)) {
    const supports = new Set(group.map((p) => p.liabilityBankTag.toString()));

    let coversAll = true;
    for (const rt of requiredTags) {
      if (!supports.has(rt)) {
        coversAll = false;
        break;
      }
    }
    if (coversAll) {
      validGroups.push(group);
    }
  }

  // 6) Return all valid groups flattened (selection happens elsewhere)
  if (validGroups.length === 0) return [];

  // Flatten all valid groups into a single array
  return validGroups.flat();
}
