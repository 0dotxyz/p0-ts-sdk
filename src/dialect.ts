import { PublicKey } from "@solana/web3.js";

/**
 * TEMPORARY: 0.1.9 → 0.1.10 program upgrade switch. See UPGRADE-0.1.10.md.
 *
 * 0.1.10 inserts required accounts into six instructions (positional wire
 * break, both directions). For the three the SDK executes or simulates
 * (end-flashloan, transfer, pulse-health), the builders in `instructions.ts`
 * build 0.1.10-style and inline-remove the inserted account while the target
 * program still runs 0.1.9 — decided by the announced upgrade time below.
 *
 * TODO(upgrade): delete this file (and the three inline checks) once the
 * upgrade is final.
 */

/**
 * Unix seconds (per program id) at which that deployment runs program 0.1.10.
 * `0` = already upgraded; unlisted programs count as already upgraded.
 */
export const MARGINFI_V0_1_10_ACTIVATION: Record<string, number> = {
  // mainnet — upgrades Tuesday 2026-08-25 17:00 CEST (15:00 UTC)
  MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA: 1787670000,
  // staging — running 0.1.10 since 2026-08-03
  stag8sTKds2h4KzjUw3zKTsxbqvT4XKHdaR9X9E6Rct: 0,
};

/** Whether `programId` runs program 0.1.10 at `atUnixSeconds` (default: now). */
export function isMarginfiV0110Live(
  programId: PublicKey,
  atUnixSeconds: number = Math.floor(Date.now() / 1000)
): boolean {
  return atUnixSeconds >= (MARGINFI_V0_1_10_ACTIVATION[programId.toBase58()] ?? 0);
}
