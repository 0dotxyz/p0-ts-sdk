import { Connection, PublicKey } from "@solana/web3.js";

import { Marginfi as MarginfiIdlTypeV0_1_10 } from "./marginfi-types_0.1.10";
import MARGINFI_IDL_V0_1_10_JSON from "./marginfi_0.1.10.json";

type MarginfiIdlType = MarginfiIdlTypeV0_1_10;

/**
 * On-chain marginfi program versions this SDK can talk to.
 *
 * - `"0.1.9"`  — the legacy program (mainnet before the 0.1.10 upgrade)
 * - `"0.1.10"` — the current program (staging `stag8s…`, mainnet post-upgrade)
 *
 * The two versions are wire-incompatible for six instructions (`group` /
 * `fee_state` accounts were inserted positionally), so instruction building
 * must go through the IDL variant that matches the deployed program.
 * Deserialization is compatible in both directions.
 */
export type MarginfiProgramVersion = "0.1.9" | "0.1.10";

/** MarginfiGroup struct size (excl. 8-byte discriminator) on 0.1.10+. */
const MARGINFI_GROUP_V2_LEN = 9248;
/** MarginfiGroup struct size (excl. 8-byte discriminator) on 0.1.9. */
const MARGINFI_GROUP_V1_LEN = 1056;

/**
 * Accounts that 0.1.10 inserted into existing instructions. Removing them from
 * the IDL reproduces the exact 0.1.9 account layout for those instructions.
 */
const LEGACY_REMOVED_ACCOUNTS: Record<string, string[]> = {
  lending_account_end_flashloan: ["group"],
  lending_account_pulse_health: ["group"],
  transfer_to_new_account: ["fee_state"],
  transfer_to_new_account_pda: ["fee_state"],
  start_liquidation: ["group"],
  end_liquidation: ["group", "fee_payer"],
};

/**
 * `BankConfigOpt` fields appended in 0.1.10 (liquidation fees + circuit
 * breaker). Removing them makes `lending_pool_configure_bank` args encode
 * byte-identically to 0.1.9.
 */
const LEGACY_REMOVED_BANK_CONFIG_OPT_FIELDS = [
  "liquidation_liquidator_fee",
  "liquidation_insurance_fee",
  "circuit_breaker_enabled",
  "cb_deviation_bps_tiers",
  "cb_tier_durations_seconds",
  "cb_escalation_window_mult",
  "cb_ema_alpha_bps",
  "cb_window_seconds",
  "cb_window_max_up_bps",
  "cb_window_max_down_bps",
];

let cachedLegacyIdl: MarginfiIdlType | undefined;

/**
 * The bundled 0.1.10 IDL transformed back to the 0.1.9 wire format: the six
 * changed instructions lose their inserted accounts and `BankConfigOpt` loses
 * the appended fields. Everything else (account layouts, discriminators,
 * errors) is forward-identical, so this is safe to decode 0.1.9 accounts and
 * REQUIRED to build transactions against the 0.1.9 program.
 *
 * Computed lazily from the bundled IDL so the package doesn't ship a second
 * ~450KB JSON.
 */
export function getMarginfiLegacyIdl(): MarginfiIdlType {
  if (!cachedLegacyIdl) {
    const idl = JSON.parse(JSON.stringify(MARGINFI_IDL_V0_1_10_JSON));
    for (const instruction of idl.instructions) {
      const removed = LEGACY_REMOVED_ACCOUNTS[instruction.name];
      if (removed) {
        instruction.accounts = instruction.accounts.filter(
          (account: { name: string }) => !removed.includes(account.name)
        );
      }
    }
    const bankConfigOpt = idl.types.find((t: { name: string }) => t.name === "BankConfigOpt");
    if (bankConfigOpt) {
      bankConfigOpt.type.fields = bankConfigOpt.type.fields.filter(
        (field: { name: string }) => !LEGACY_REMOVED_BANK_CONFIG_OPT_FIELDS.includes(field.name)
      );
    }
    cachedLegacyIdl = idl as MarginfiIdlType;
  }
  return cachedLegacyIdl;
}

/**
 * Pick the IDL variant matching a program version, optionally stamping the
 * program address (as `Program` construction requires).
 */
export function marginfiIdlFor(
  version: MarginfiProgramVersion,
  programId?: PublicKey
): MarginfiIdlType {
  const base =
    version === "0.1.9" ? getMarginfiLegacyIdl() : (MARGINFI_IDL_V0_1_10_JSON as MarginfiIdlType);
  return programId ? ({ ...base, address: programId.toBase58() } as MarginfiIdlType) : base;
}

/**
 * Infer the deployed program version from a raw MarginfiGroup account size.
 * The 0.1.10 upgrade resizes every group 1,056 → 9,248 bytes (excl.
 * discriminator) immediately post-deploy, so group size tracks the program
 * version except during the few-minute resize window — during which the new
 * program cannot load the unresized group and every instruction fails anyway.
 */
export function detectProgramVersionFromGroupData(dataLength: number): MarginfiProgramVersion {
  return dataLength >= 8 + MARGINFI_GROUP_V2_LEN ? "0.1.10" : "0.1.9";
}

/**
 * Detect the deployed program version by inspecting the group account
 * on-chain. One `getAccountInfo` call.
 *
 * NOTE: detection is a point-in-time snapshot. Long-lived processes that hold
 * a client across a program upgrade should re-instantiate (or re-detect) after
 * the upgrade window.
 */
export async function detectMarginfiProgramVersion(
  connection: Connection,
  groupPk: PublicKey
): Promise<MarginfiProgramVersion> {
  const info = await connection.getAccountInfo(groupPk);
  if (!info) {
    throw new Error(
      `Marginfi group ${groupPk.toBase58()} not found — cannot detect program version`
    );
  }
  return detectProgramVersionFromGroupData(info.data.length);
}

/**
 * Whether a constructed Anchor program speaks the legacy (0.1.9) wire format.
 * Authoritative because the runtime IDL is what the instruction coder uses.
 */
export function isLegacyMarginfiProgram(program: { idl: unknown }): boolean {
  const idl = program.idl as {
    instructions?: { name: string; accounts: { name: string }[] }[];
  };
  // Anchor's `Program` stores a camelCased copy of the IDL it was constructed
  // with, so match either naming.
  const endFlashloan = idl.instructions?.find(
    (ix) => ix.name === "lending_account_end_flashloan" || ix.name === "lendingAccountEndFlashloan"
  );
  if (!endFlashloan) return false;
  return !endFlashloan.accounts.some((account) => account.name === "group");
}

/** MarginfiGroup struct sizes per program version (excl. 8-byte discriminator). */
export const MARGINFI_GROUP_SIZES = {
  "0.1.9": MARGINFI_GROUP_V1_LEN,
  "0.1.10": MARGINFI_GROUP_V2_LEN,
} as const;
