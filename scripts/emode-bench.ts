/**
 * emode-bench.ts — correctness + performance A/B for the emode string-key refactor.
 *
 * Run:  npx tsx scripts/emode-bench.ts
 *
 * What it does:
 *   1. Builds a deterministic synthetic scenario at production scale
 *      (~200 banks, ~100 emode pairs, a handful of active liabilities/collateral).
 *   2. Runs the LEGACY `computeEmodeImpacts` (inlined verbatim below, pre-refactor)
 *      and the NEW one (imported from src) on identical inputs.
 *   3. Asserts byte-identical output via a canonical serialization
 *      (PublicKey → base58, BigNumber → string).
 *   4. Times both over many iterations and reports the speedup.
 *
 * This mirrors the script Kobe used to measure the pubkey→string win.
 */
import { PublicKey } from "@solana/web3.js";
import BigNumber from "bignumber.js";

import {
  computeEmodeImpacts,
  createActiveEmodePairFromPairs,
} from "../src/services/account/utils/emode.utils";
import {
  EmodeImpactStatus,
  EmodeTag,
  type ActionEmodeImpact,
  type EmodeImpact,
  type EmodePair,
} from "../src/services/bank/types";

// ----------------------------------------------------------------------------
// Deterministic RNG + key generation
// ----------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rng = mulberry32(0xc0ffee);

function randPubkey(): PublicKey {
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) bytes[i] = Math.floor(rng() * 256);
  return new PublicKey(bytes);
}

function randWeight(): BigNumber {
  // [0.50, 0.95)
  return new BigNumber(0.5 + rng() * 0.45);
}

// ----------------------------------------------------------------------------
// Synthetic scenario (production-ish scale)
// ----------------------------------------------------------------------------

const TAGS: EmodeTag[] = [
  EmodeTag.SOL,
  EmodeTag.LST_T1,
  EmodeTag.LST_T2,
  EmodeTag.JLP,
  EmodeTag.STABLE_T1,
  EmodeTag.STABLE_T2,
  EmodeTag.BTC_T1,
];

const BANK_COUNT = 200;
const PAIR_COUNT = 100;

const banks: PublicKey[] = Array.from({ length: BANK_COUNT }, () => randPubkey());

// Assign each bank a tag (some UNSET), and group banks by tag.
const bankTag: EmodeTag[] = banks.map((_, i) =>
  i % 9 === 0 ? EmodeTag.UNSET : TAGS[i % TAGS.length]!
);
const banksByTag = new Map<EmodeTag, PublicKey[]>();
banks.forEach((bank, i) => {
  const tag = bankTag[i]!;
  if (tag === EmodeTag.UNSET) return;
  (banksByTag.get(tag) ?? banksByTag.set(tag, []).get(tag)!).push(bank);
});

// Build pairs in the shape `getEmodePairs` produces: one liability bank, many
// collateral banks (all banks sharing the chosen collateral tag).
const liabilityCandidates = banks.filter((_, i) => bankTag[i] !== EmodeTag.UNSET);
const emodePairs: EmodePair[] = [];
for (let i = 0; i < PAIR_COUNT; i++) {
  const liabilityBank = liabilityCandidates[i % liabilityCandidates.length]!;
  const liabilityBankTag = bankTag[banks.indexOf(liabilityBank)] ?? EmodeTag.SOL;
  // pick a collateral tag (rotate so groups form across tags)
  const collateralBankTag = TAGS[(i + 1) % TAGS.length]!;
  const collateralBanks = banksByTag.get(collateralBankTag) ?? [];
  emodePairs.push({
    collateralBanks,
    collateralBankTag,
    liabilityBank,
    liabilityBankTag,
    assetWeightMaint: randWeight(),
    assetWeightInit: randWeight(),
  });
}

// Active positions chosen so EMODE is actually ON (exercises the hot branches).
const activeLiabilities: PublicKey[] = [
  emodePairs[0]!.liabilityBank,
  emodePairs[1]!.liabilityBank,
  emodePairs[2]!.liabilityBank,
];
const activeCollateral: PublicKey[] = [
  ...emodePairs[0]!.collateralBanks.slice(0, 3),
  ...emodePairs[1]!.collateralBanks.slice(0, 2),
];
const allBanks = banks;

// ----------------------------------------------------------------------------
// LEGACY implementation (verbatim pre-refactor, for A/B comparison)
// ----------------------------------------------------------------------------

function legacyComputeActiveEmodePairs(
  emodePairs: EmodePair[],
  activeLiabilities: PublicKey[],
  activeCollateral: PublicKey[]
): EmodePair[] {
  const configured = emodePairs.filter(
    (p) => p.collateralBankTag !== EmodeTag.UNSET && p.liabilityBankTag !== EmodeTag.UNSET
  );

  const liabTagByBank = new Map<string, string>();
  for (const p of configured) {
    liabTagByBank.set(p.liabilityBank.toBase58(), p.liabilityBankTag.toString());
  }
  const requiredTags = new Set<string>();
  for (const liab of activeLiabilities) {
    const tag = liabTagByBank.get(liab.toBase58());
    if (!tag) return [];
    requiredTags.add(tag);
  }

  const possible = configured.filter(
    (p) =>
      activeLiabilities.some((l) => l.equals(p.liabilityBank)) &&
      p.collateralBanks.some((c) => activeCollateral.some((a) => a.equals(c)))
  );
  if (possible.length === 0) return [];

  const byCollTag: Record<string, EmodePair[]> = {};
  for (const p of possible) {
    const ct = p.collateralBankTag.toString();
    (byCollTag[ct] ||= []).push(p);
  }

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
    if (coversAll) validGroups.push(group);
  }
  if (validGroups.length === 0) return [];
  return validGroups.flat();
}

function legacyComputeEmodeImpacts(
  emodePairs: EmodePair[],
  activeLiabilities: PublicKey[],
  activeCollateral: PublicKey[],
  allBanks: PublicKey[]
): Record<string, ActionEmodeImpact> {
  const toKey = (k: PublicKey) => k.toBase58();

  const basePairs = legacyComputeActiveEmodePairs(emodePairs, activeLiabilities, activeCollateral);
  const baseOn = basePairs.length > 0;

  const liabTagMap = new Map<string, string>();
  for (const p of emodePairs) {
    liabTagMap.set(p.liabilityBank.toBase58(), p.liabilityBankTag.toString());
  }
  const existingTags = new Set<string>(
    activeLiabilities.map((l) => liabTagMap.get(l.toBase58())).filter((t): t is string => !!t)
  );

  function minWeight(ps: EmodePair[]): BigNumber {
    let m = ps[0]!.assetWeightInit;
    for (const x of ps) if (x.assetWeightInit.lt(m)) m = x.assetWeightInit;
    return m;
  }

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

  function simulate(
    bank: PublicKey,
    action: "borrow" | "repay" | "supply" | "withdraw"
  ): EmodeImpact {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
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

    const after = legacyComputeActiveEmodePairs(emodePairs, L, C);
    let status = diffState(basePairs, after);

    if (action === "borrow") {
      const tag = liabTagMap.get(bank.toBase58());
      if (!tag) {
        status = baseOn ? EmodeImpactStatus.RemoveEmode : EmodeImpactStatus.InactiveEmode;
      } else if (baseOn) {
        if (after.length === 0) {
          status = EmodeImpactStatus.RemoveEmode;
        } else if (existingTags.has(tag)) {
          status = EmodeImpactStatus.ExtendEmode;
        }
      }
    }

    if (action === "supply") {
      const isOn = after.length > 0;
      status =
        !baseOn && isOn
          ? EmodeImpactStatus.ActivateEmode
          : baseOn && isOn
            ? EmodeImpactStatus.ExtendEmode
            : EmodeImpactStatus.InactiveEmode;
    }

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

    const activeEmodePair = createActiveEmodePairFromPairs(after);
    return { status, resultingPairs: after, activePair: activeEmodePair };
  }

  const result: Record<string, ActionEmodeImpact> = {};
  for (const bank of allBanks) {
    const key = toKey(bank);
    const impact: ActionEmodeImpact = {};
    if (!activeCollateral.some((x) => x.equals(bank))) {
      impact.borrowImpact = simulate(bank, "borrow");
    }
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

// ----------------------------------------------------------------------------
// VARIANT — strings, but NO hoist (index rebuilt every call). This isolates the
// two levers cleanly:
//   legacy (PublicKey + rebuild)  →  stringsOnly (strings + rebuild)  = STRING-KEYS lever
//   stringsOnly (strings + rebuild)  →  final (strings + hoist)       = BUILD-ONCE lever
// ----------------------------------------------------------------------------

type Indexed = {
  orig: EmodePair;
  liabStr: string;
  liabTagStr: string;
  collTagStr: string;
  collStrs: string[];
};

function buildIndex(emodePairs: EmodePair[]): {
  configured: Indexed[];
  liabTagByBank: Map<string, string>;
} {
  const configured: Indexed[] = [];
  const liabTagByBank = new Map<string, string>();
  for (const p of emodePairs) {
    if (p.collateralBankTag === EmodeTag.UNSET || p.liabilityBankTag === EmodeTag.UNSET) continue;
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

function activeFromIndex(
  configured: Indexed[],
  liabTagByBank: Map<string, string>,
  liabSet: Set<string>,
  collSet: Set<string>
): EmodePair[] {
  const requiredTags = new Set<string>();
  for (const liab of liabSet) {
    const tag = liabTagByBank.get(liab);
    if (!tag) return [];
    requiredTags.add(tag);
  }
  const possible = configured.filter(
    (p) => liabSet.has(p.liabStr) && p.collStrs.some((c) => collSet.has(c))
  );
  if (possible.length === 0) return [];
  const byCollTag: Record<string, Indexed[]> = {};
  for (const p of possible) (byCollTag[p.collTagStr] ||= []).push(p);
  const validGroups: Indexed[][] = [];
  for (const group of Object.values(byCollTag)) {
    const supports = new Set(group.map((p) => p.liabTagStr));
    let coversAll = true;
    for (const rt of requiredTags) if (!supports.has(rt)) { coversAll = false; break; }
    if (coversAll) validGroups.push(group);
  }
  if (validGroups.length === 0) return [];
  return validGroups.flat().map((p) => p.orig);
}

function mw(ps: EmodePair[]): BigNumber {
  let m = ps[0]!.assetWeightInit;
  for (const x of ps) if (x.assetWeightInit.lt(m)) m = x.assetWeightInit;
  return m;
}
function ds(before: EmodePair[], after: EmodePair[]): EmodeImpactStatus {
  const was = before.length > 0,
    isOn = after.length > 0;
  if (!was && !isOn) return EmodeImpactStatus.InactiveEmode;
  if (!was && isOn) return EmodeImpactStatus.ActivateEmode;
  if (was && !isOn) return EmodeImpactStatus.RemoveEmode;
  const bMin = mw(before),
    aMin = mw(after);
  if (aMin.gt(bMin)) return EmodeImpactStatus.IncreaseEmode;
  if (aMin.lt(bMin)) return EmodeImpactStatus.ReduceEmode;
  return EmodeImpactStatus.ExtendEmode;
}

function computeEmodeImpacts_stringsOnly(
  emodePairs: EmodePair[],
  activeLiabilities: PublicKey[],
  activeCollateral: PublicKey[],
  allBanks: PublicKey[]
): Record<string, ActionEmodeImpact> {
  const liabBaseSet = new Set(activeLiabilities.map((b) => b.toBase58()));
  const collBaseSet = new Set(activeCollateral.map((b) => b.toBase58()));
  const liabTagMapAll = new Map<string, string>();
  for (const p of emodePairs)
    liabTagMapAll.set(p.liabilityBank.toBase58(), p.liabilityBankTag.toString());

  // NO HOIST: rebuild the index here (baseline) and again in every simulate.
  const baseIdx = buildIndex(emodePairs);
  const basePairs = activeFromIndex(baseIdx.configured, baseIdx.liabTagByBank, liabBaseSet, collBaseSet);
  const baseOn = basePairs.length > 0;
  const existingTags = new Set<string>(
    Array.from(liabBaseSet)
      .map((l) => liabTagMapAll.get(l))
      .filter((t): t is string => !!t)
  );

  function simulate(bankStr: string, action: "borrow" | "repay" | "supply" | "withdraw"): EmodeImpact {
    const L = new Set(liabBaseSet),
      C = new Set(collBaseSet);
    switch (action) {
      case "borrow": L.add(bankStr); break;
      case "repay": L.delete(bankStr); break;
      case "supply": C.add(bankStr); break;
      case "withdraw": C.delete(bankStr); break;
    }
    const idx = buildIndex(emodePairs); // ← rebuilt every call (no hoist)
    const after = activeFromIndex(idx.configured, idx.liabTagByBank, L, C);
    let status = ds(basePairs, after);
    if (action === "borrow") {
      const tag = liabTagMapAll.get(bankStr);
      if (!tag) status = baseOn ? EmodeImpactStatus.RemoveEmode : EmodeImpactStatus.InactiveEmode;
      else if (baseOn) {
        if (after.length === 0) status = EmodeImpactStatus.RemoveEmode;
        else if (existingTags.has(tag)) status = EmodeImpactStatus.ExtendEmode;
      }
    }
    if (action === "supply") {
      const isOn = after.length > 0;
      status = !baseOn && isOn ? EmodeImpactStatus.ActivateEmode : baseOn && isOn ? EmodeImpactStatus.ExtendEmode : EmodeImpactStatus.InactiveEmode;
    }
    if (action === "withdraw") {
      if (!baseOn) status = EmodeImpactStatus.InactiveEmode;
      else if (after.length === 0) status = EmodeImpactStatus.RemoveEmode;
      else {
        const b = mw(basePairs), a = mw(after);
        if (a.gt(b)) status = EmodeImpactStatus.IncreaseEmode;
        else if (a.lt(b)) status = EmodeImpactStatus.ReduceEmode;
        else status = EmodeImpactStatus.ExtendEmode;
      }
    }
    return { status, resultingPairs: after, activePair: createActiveEmodePairFromPairs(after) };
  }

  const result: Record<string, ActionEmodeImpact> = {};
  for (const bank of allBanks) {
    const key = bank.toBase58();
    const impact: ActionEmodeImpact = {};
    // NO HOIST: rebuild the all-collateral set each iteration.
    const allColl = new Set(emodePairs.flatMap((p) => p.collateralBanks.map((c) => c.toBase58())));
    if (!collBaseSet.has(key)) impact.borrowImpact = simulate(key, "borrow");
    if (allColl.has(key) && !collBaseSet.has(key) && !liabBaseSet.has(key)) impact.supplyImpact = simulate(key, "supply");
    if (liabBaseSet.has(key)) impact.repayAllImpact = simulate(key, "repay");
    if (collBaseSet.has(key)) impact.withdrawAllImpact = simulate(key, "withdraw");
    result[key] = impact;
  }
  return result;
}

// ----------------------------------------------------------------------------
// Canonical serialization for deep comparison
// ----------------------------------------------------------------------------

function canon(value: unknown): string {
  return JSON.stringify(value, (_key, v) => {
    if (v && typeof v === "object") {
      if (typeof (v as { toBase58?: unknown }).toBase58 === "function") {
        return (v as PublicKey).toBase58();
      }
      if (BigNumber.isBigNumber(v)) return v.toString();
    }
    return v;
  });
}

// ----------------------------------------------------------------------------
// Run
// ----------------------------------------------------------------------------

function summarize(result: Record<string, ActionEmodeImpact>) {
  let borrow = 0,
    supply = 0,
    repay = 0,
    withdraw = 0;
  for (const k of Object.keys(result)) {
    const a = result[k]!;
    if (a.borrowImpact) borrow++;
    if (a.supplyImpact) supply++;
    if (a.repayAllImpact) repay++;
    if (a.withdrawAllImpact) withdraw++;
  }
  return { keys: Object.keys(result).length, borrow, supply, repay, withdraw };
}

console.log("Scenario:", {
  banks: BANK_COUNT,
  pairs: PAIR_COUNT,
  activeLiabilities: activeLiabilities.length,
  activeCollateral: activeCollateral.length,
});

const legacyOut = legacyComputeEmodeImpacts(emodePairs, activeLiabilities, activeCollateral, allBanks);
const stringsOut = computeEmodeImpacts_stringsOnly(emodePairs, activeLiabilities, activeCollateral, allBanks);
const newOut = computeEmodeImpacts(emodePairs, activeLiabilities, activeCollateral, allBanks);

console.log("Legacy output:     ", summarize(legacyOut));
console.log("StringsOnly output:", summarize(stringsOut));
console.log("Final output:      ", summarize(newOut));

// --- Correctness: all three must be byte-identical ---
const legacyCanon = canon(legacyOut);
const stringsCanon = canon(stringsOut);
const newCanon = canon(newOut);
if (legacyCanon === stringsCanon && stringsCanon === newCanon) {
  console.log("\n✅ CORRECTNESS: legacy === stringsOnly === final (byte-identical)");
} else {
  console.error("\n❌ CORRECTNESS: outputs DIFFER");
  console.error("  legacy === stringsOnly:", legacyCanon === stringsCanon);
  console.error("  stringsOnly === final: ", stringsCanon === newCanon);
  process.exit(1);
}

// --- Performance: isolate the two levers ---
const ITERS = 50;

function time(fn: () => void, iters: number): number {
  for (let i = 0; i < 5; i++) fn(); // warmup
  const start = performance.now();
  for (let i = 0; i < iters; i++) fn();
  return (performance.now() - start) / iters;
}

const legacyMs = time(() => legacyComputeEmodeImpacts(emodePairs, activeLiabilities, activeCollateral, allBanks), ITERS);
const stringsMs = time(() => computeEmodeImpacts_stringsOnly(emodePairs, activeLiabilities, activeCollateral, allBanks), ITERS);
const newMs = time(() => computeEmodeImpacts(emodePairs, activeLiabilities, activeCollateral, allBanks), ITERS);

console.log("\nPERFORMANCE (avg over", ITERS, "iters):");
console.log(`  1. legacy      (PublicKey + rebuild): ${legacyMs.toFixed(3)} ms`);
console.log(`  2. stringsOnly (strings   + rebuild): ${stringsMs.toFixed(3)} ms`);
console.log(`  3. final       (strings   + hoist):   ${newMs.toFixed(3)} ms`);

console.log("\nLEVER ATTRIBUTION:");
console.log(`  string-keys lever  (1 → 2): ${(legacyMs / stringsMs).toFixed(2)}x   (${(legacyMs - stringsMs).toFixed(1)} ms saved)`);
console.log(`  build-once  lever  (2 → 3): ${(stringsMs / newMs).toFixed(2)}x   (${(stringsMs - newMs).toFixed(1)} ms saved)`);
console.log(`  total              (1 → 3): ${(legacyMs / newMs).toFixed(1)}x`);

// Share of total time saved attributable to each lever.
const totalSaved = legacyMs - newMs;
console.log("\nSHARE OF TOTAL SPEEDUP:");
console.log(`  string-keys: ${(((legacyMs - stringsMs) / totalSaved) * 100).toFixed(1)}%`);
console.log(`  build-once:  ${(((stringsMs - newMs) / totalSaved) * 100).toFixed(1)}%`);
