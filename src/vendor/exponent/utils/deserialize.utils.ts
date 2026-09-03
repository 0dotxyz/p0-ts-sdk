import { BorshAccountsCoder, type Idl } from "@coral-xyz/anchor";
import { Connection, PublicKey } from "@solana/web3.js";
import { BigNumber } from "bignumber.js";
import BN from "bn.js";

import { EXPONENT_CLMM_IDL, EXPONENT_CORE_IDL } from "../idl";
import {
  ExponentCpiInterfaceContext,
  ExponentMarketThree,
  ExponentMarketTwo,
  ExponentVault,
} from "../types";

/**
 * Exponent's high-precision `Number` is a little-endian U256 (`[u64; 4]`) scaled by 1e12
 * (`precise_number::ONE`). See exponent-core `libraries/precise_number`.
 */
export const EXPONENT_NUMBER_DENOM = new BigNumber(1e12);

const EXPONENT_ACCOUNTS_CODER = new BorshAccountsCoder(EXPONENT_CORE_IDL as unknown as Idl);
const EXPONENT_CLMM_ACCOUNTS_CODER = new BorshAccountsCoder(EXPONENT_CLMM_IDL as unknown as Idl);

/** Convert a decoded Exponent `Number` (LE `[u64; 4]` U256) to a scaled BigNumber. */
export function exponentNumberToBigNumber(raw: unknown): BigNumber {
  // Anchor decodes the tuple-struct `Number([u64;4])` defensively across shapes:
  // an array of BN/number, or an object wrapping that array.
  let words: unknown = raw;
  if (!Array.isArray(words) && words && typeof words === "object") {
    words = (words as Record<string, unknown>)[0] ?? Object.values(words)[0];
  }
  if (!Array.isArray(words)) {
    throw new Error("exponentNumberToBigNumber: unexpected Number shape");
  }

  let value = new BigNumber(0);
  const TWO_64 = new BigNumber(2).pow(64);
  words.forEach((w, i) => {
    const word = new BigNumber(BN.isBN(w) ? w.toString() : String(w));
    value = value.plus(word.times(TWO_64.pow(i)));
  });
  return value.div(EXPONENT_NUMBER_DENOM);
}

function pk(v: unknown): PublicKey {
  return v instanceof PublicKey ? v : new PublicKey(v as string);
}

/** Decode a raw `Vault` account buffer into {@link ExponentVault}. */
export function decodeExponentVault(data: Buffer): ExponentVault {
  const d = EXPONENT_ACCOUNTS_CODER.decode("Vault", data);
  const get = (snake: string, camel: string) => d[snake] ?? d[camel];
  const u64 = (v: unknown): bigint => BigInt(BN.isBN(v) ? v.toString() : String(v ?? 0));

  const cpi = (get("cpi_accounts", "cpiAccounts") ?? {}) as Record<string, unknown>;

  return {
    authority: pk(get("authority", "authority")),
    syProgram: pk(get("sy_program", "syProgram")),
    mintSy: pk(get("mint_sy", "mintSy")),
    mintYt: pk(get("mint_yt", "mintYt")),
    mintPt: pk(get("mint_pt", "mintPt")),
    escrowSy: pk(get("escrow_sy", "escrowSy")),
    yieldPosition: pk(get("yield_position", "yieldPosition")),
    addressLookupTable: pk(get("address_lookup_table", "addressLookupTable")),
    cpiAccounts: {
      getSyState: decodeCpiContexts(cpi.get_sy_state ?? cpi.getSyState),
      depositSy: decodeCpiContexts(cpi.deposit_sy ?? cpi.depositSy),
      withdrawSy: decodeCpiContexts(cpi.withdraw_sy ?? cpi.withdrawSy),
    },
    syForPt: u64(get("sy_for_pt", "syForPt")),
    ptSupply: u64(get("pt_supply", "ptSupply")),
    lastSeenSyExchangeRate: exponentNumberToBigNumber(
      get("last_seen_sy_exchange_rate", "lastSeenSyExchangeRate")
    ),
    finalSyExchangeRate: exponentNumberToBigNumber(
      get("final_sy_exchange_rate", "finalSyExchangeRate")
    ),
    status: Number(get("status", "status") ?? 0),
    startTs: Number(get("start_ts", "startTs") ?? 0),
    duration: Number(get("duration", "duration") ?? 0),
  };
}

/** Decode a `MarketTwo` account and return its `vault` address. */
export function decodeExponentMarketVault(data: Buffer): PublicKey {
  const d = EXPONENT_ACCOUNTS_CODER.decode("MarketTwo", data);
  return pk(d.vault);
}

/** Decode an Anchor-decoded list of `CpiInterfaceContext` (snake/camel tolerant). */
function decodeCpiContexts(raw: unknown): ExponentCpiInterfaceContext[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((c) => {
    const o = (c ?? {}) as Record<string, unknown>;
    return {
      altIndex: Number(o.alt_index ?? o.altIndex ?? 0),
      isSigner: Boolean(o.is_signer ?? o.isSigner ?? false),
      isWritable: Boolean(o.is_writable ?? o.isWritable ?? false),
    };
  });
}

/** Decode a raw `MarketTwo` account buffer into {@link ExponentMarketTwo}. */
export function decodeExponentMarketTwo(data: Buffer): ExponentMarketTwo {
  const d = EXPONENT_ACCOUNTS_CODER.decode("MarketTwo", data);
  const get = (snake: string, camel: string) => d[snake] ?? d[camel];
  const cpi = (get("cpi_accounts", "cpiAccounts") ?? {}) as Record<string, unknown>;

  return {
    selfAddress: pk(get("self_address", "selfAddress")),
    mintPt: pk(get("mint_pt", "mintPt")),
    mintSy: pk(get("mint_sy", "mintSy")),
    vault: pk(get("vault", "vault")),
    tokenPtEscrow: pk(get("token_pt_escrow", "tokenPtEscrow")),
    tokenSyEscrow: pk(get("token_sy_escrow", "tokenSyEscrow")),
    tokenFeeTreasurySy: pk(get("token_fee_treasury_sy", "tokenFeeTreasurySy")),
    addressLookupTable: pk(get("address_lookup_table", "addressLookupTable")),
    syProgram: pk(get("sy_program", "syProgram")),
    statusFlags: Number(get("status_flags", "statusFlags") ?? 0),
    cpiAccounts: {
      getSyState: decodeCpiContexts(cpi.get_sy_state ?? cpi.getSyState),
      depositSy: decodeCpiContexts(cpi.deposit_sy ?? cpi.depositSy),
      withdrawSy: decodeCpiContexts(cpi.withdraw_sy ?? cpi.withdrawSy),
    },
  };
}

/** Fetch + decode an Exponent `MarketTwo` account. */
export async function fetchExponentMarketTwo(
  connection: Connection,
  market: PublicKey
): Promise<ExponentMarketTwo> {
  const info = await connection.getAccountInfo(market);
  if (!info) throw new Error(`Exponent market account not found: ${market.toBase58()}`);
  return decodeExponentMarketTwo(info.data);
}

/** Decode a raw `MarketThree` (CLMM) pool account buffer into {@link ExponentMarketThree}. */
export function decodeExponentMarketThree(data: Buffer): ExponentMarketThree {
  const d = EXPONENT_CLMM_ACCOUNTS_CODER.decode("MarketThree", data);
  const get = (snake: string, camel: string) => d[snake] ?? d[camel];
  const cpi = (get("cpi_sy_accounts", "cpiSyAccounts") ?? {}) as Record<string, unknown>;

  return {
    selfAddress: pk(get("self_address", "selfAddress")),
    mintPt: pk(get("mint_pt", "mintPt")),
    mintSy: pk(get("mint_sy", "mintSy")),
    vault: pk(get("vault", "vault")),
    ticks: pk(get("ticks", "ticks")),
    tokenPtEscrow: pk(get("token_pt_escrow", "tokenPtEscrow")),
    tokenSyEscrow: pk(get("token_sy_escrow", "tokenSyEscrow")),
    tokenFeeTreasurySy: pk(get("token_fee_treasury_sy", "tokenFeeTreasurySy")),
    tokenFeeTreasuryPt: pk(get("token_fee_treasury_pt", "tokenFeeTreasuryPt")),
    addressLookupTable: pk(get("address_lookup_table", "addressLookupTable")),
    syProgram: pk(get("sy_program", "syProgram")),
    statusFlags: Number(get("status_flags", "statusFlags") ?? 0),
    cpiAccounts: {
      getSyState: decodeCpiContexts(cpi.get_sy_state ?? cpi.getSyState),
      getPositionState: decodeCpiContexts(cpi.get_position_state ?? cpi.getPositionState),
      depositSy: decodeCpiContexts(cpi.deposit_sy ?? cpi.depositSy),
      withdrawSy: decodeCpiContexts(cpi.withdraw_sy ?? cpi.withdrawSy),
    },
  };
}

/** Fetch + decode an Exponent `MarketThree` (CLMM) pool account. */
export async function fetchExponentMarketThree(
  connection: Connection,
  market: PublicKey
): Promise<ExponentMarketThree> {
  const info = await connection.getAccountInfo(market);
  if (!info) throw new Error(`Exponent CLMM market account not found: ${market.toBase58()}`);
  return decodeExponentMarketThree(info.data);
}

/** Fetch + decode an Exponent `Vault` account. */
export async function fetchExponentVault(
  connection: Connection,
  vault: PublicKey
): Promise<ExponentVault> {
  const info = await connection.getAccountInfo(vault);
  if (!info) throw new Error(`Exponent vault account not found: ${vault.toBase58()}`);
  return decodeExponentVault(info.data);
}

/** Fetch a `MarketTwo` account and resolve + fetch its `Vault`. */
export async function fetchExponentVaultFromMarket(
  connection: Connection,
  market: PublicKey
): Promise<{ vault: PublicKey; account: ExponentVault }> {
  const info = await connection.getAccountInfo(market);
  if (!info) throw new Error(`Exponent market account not found: ${market.toBase58()}`);
  const vault = decodeExponentMarketVault(info.data);
  return { vault, account: await fetchExponentVault(connection, vault) };
}

/** Read an SPL mint's decimals (classic + token-2022 share the offset-44 layout). */
export async function getMintDecimals(connection: Connection, mint: PublicKey): Promise<number> {
  const info = await connection.getAccountInfo(mint);
  if (!info) throw new Error(`mint account not found: ${mint.toBase58()}`);
  return info.data[44];
}
