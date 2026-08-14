import { Connection, PublicKey } from "@solana/web3.js";
import { Program } from "@coral-xyz/anchor";

import { MarginfiProgram } from "~/types";
import {
  MarginfiProgramVersion,
  isLegacyMarginfiProgram,
  marginfiIdlFor,
} from "~/idl";

/**
 * Automatic wire-format ("dialect") resolution.
 *
 * A consumer can construct their Anchor `Program` from any IDL variant — most
 * will spread the static `MARGINFI_IDL` (0.1.10). If the program they point at
 * is actually the legacy 0.1.9 deployment, six instructions would be built
 * with the wrong account layout. The builders in `instructions.ts` guard
 * against that by calling {@link ensureMarginfiDialectProgram}, which detects
 * the deployed version on-chain (cached) and transparently swaps in a Program
 * carrying the matching IDL. Consumers never see any of this.
 *
 * Detection reads the FeeState PDA (derivable from the program id alone):
 * 264 bytes on 0.1.9 vs 520 on 0.1.10. Results are cached per program id with
 * a short TTL so the flip propagates within a minute of the mainnet upgrade.
 */

const FEE_STATE_SEED = Buffer.from("feestate", "utf-8");
const FEE_STATE_V2_ACCOUNT_SIZE = 8 + 512; // discriminator + FeeState (0.1.10+)

const VERSION_CACHE_TTL_MS = 60_000;

const versionCache = new Map<
  string,
  { version: MarginfiProgramVersion; fetchedAt: number }
>();
const dialectProgramCache = new Map<string, MarginfiProgram>();

/** Infer the program version from a raw FeeState account size. */
export function detectProgramVersionFromFeeStateData(
  dataLength: number
): MarginfiProgramVersion {
  return dataLength >= FEE_STATE_V2_ACCOUNT_SIZE ? "0.1.10" : "0.1.9";
}

/**
 * Detect the deployed program version from its FeeState PDA, cached per
 * program id (60s TTL). One small `getAccountInfo` on cache miss.
 */
export async function resolveMarginfiProgramVersion(
  connection: Connection,
  programId: PublicKey
): Promise<MarginfiProgramVersion> {
  const key = programId.toBase58();
  const cached = versionCache.get(key);
  if (cached && Date.now() - cached.fetchedAt < VERSION_CACHE_TTL_MS) {
    return cached.version;
  }
  const [feeStateKey] = PublicKey.findProgramAddressSync([FEE_STATE_SEED], programId);
  const info = await connection.getAccountInfo(feeStateKey);
  if (!info) {
    throw new Error(
      `FeeState ${feeStateKey.toBase58()} not found for program ${key} — cannot detect program version`
    );
  }
  const version = detectProgramVersionFromFeeStateData(info.data.length);
  versionCache.set(key, { version, fetchedAt: Date.now() });
  return version;
}

/**
 * The last detected (or seeded) version for a program id, if any — TTL is
 * ignored so synchronous callers always have a best-known answer.
 */
export function getCachedMarginfiProgramVersion(
  programId: PublicKey
): MarginfiProgramVersion | undefined {
  return versionCache.get(programId.toBase58())?.version;
}

/** Seed the detection cache (used by `Project0Client.initialize`). */
export function seedMarginfiProgramVersionCache(
  programId: PublicKey,
  version: MarginfiProgramVersion
): void {
  versionCache.set(programId.toBase58(), { version, fetchedAt: Date.now() });
}

/**
 * Best-known dialect for a program object WITHOUT hitting the network: the
 * cached on-chain detection if one exists (seeded by any async builder call or
 * client init), otherwise whatever IDL the program was constructed with. Used
 * by the synchronous (simulation) builders, which cannot await detection.
 */
export function isLegacyMarginfiDialect(program: MarginfiProgram): boolean {
  const cached = getCachedMarginfiProgramVersion(program.programId);
  if (cached) return cached === "0.1.9";
  return isLegacyMarginfiProgram(program);
}

/**
 * Return a Program whose runtime IDL matches the DEPLOYED program version,
 * regardless of which IDL variant the caller constructed theirs with. Same
 * provider/connection; swapped instances are cached per (program id, version).
 */
export async function ensureMarginfiDialectProgram(
  program: MarginfiProgram
): Promise<MarginfiProgram> {
  const version = await resolveMarginfiProgramVersion(
    program.provider.connection,
    program.programId
  );
  const programIsLegacy = isLegacyMarginfiProgram(program);
  if ((version === "0.1.9") === programIsLegacy) return program;

  const key = `${program.programId.toBase58()}:${version}`;
  let swapped = dialectProgramCache.get(key);
  if (!swapped) {
    swapped = new Program(
      marginfiIdlFor(version, program.programId),
      program.provider
    ) as unknown as MarginfiProgram;
    dialectProgramCache.set(key, swapped);
  }
  return swapped;
}
