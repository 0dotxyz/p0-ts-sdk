import BN from "bn.js";
import { BigNumber } from "bignumber.js";
import { BorshAccountsCoder, type Idl } from "@coral-xyz/anchor";
import { Connection, PublicKey } from "@solana/web3.js";

import { EXPONENT_CORE_IDL } from "../idl";
import { ExponentVault } from "../types";

/**
 * Exponent's high-precision `Number` is a little-endian U256 (`[u64; 4]`) scaled by 1e12
 * (`precise_number::ONE`). See exponent-core `libraries/precise_number`.
 */
export const EXPONENT_NUMBER_DENOM = new BigNumber(1e12);

const EXPONENT_ACCOUNTS_CODER = new BorshAccountsCoder(EXPONENT_CORE_IDL as unknown as Idl);

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
    const word = new BigNumber(BN.isBN(w) ? (w as BN).toString() : String(w));
    value = value.plus(word.times(TWO_64.pow(i)));
  });
  return value.div(EXPONENT_NUMBER_DENOM);
}

function pk(v: unknown): PublicKey {
  return v instanceof PublicKey ? v : new PublicKey(v as string);
}

/** Decode a raw `Vault` account buffer into {@link ExponentVault}. */
export function decodeExponentVault(data: Buffer): ExponentVault {
  const d = EXPONENT_ACCOUNTS_CODER.decode("Vault", data) as Record<string, unknown>;
  const get = (snake: string, camel: string) => d[snake] ?? d[camel];

  return {
    authority: pk(get("authority", "authority")),
    syProgram: pk(get("sy_program", "syProgram")),
    mintSy: pk(get("mint_sy", "mintSy")),
    mintYt: pk(get("mint_yt", "mintYt")),
    mintPt: pk(get("mint_pt", "mintPt")),
    escrowSy: pk(get("escrow_sy", "escrowSy")),
    yieldPosition: pk(get("yield_position", "yieldPosition")),
    addressLookupTable: pk(get("address_lookup_table", "addressLookupTable")),
    finalSyExchangeRate: exponentNumberToBigNumber(
      get("final_sy_exchange_rate", "finalSyExchangeRate")
    ),
    status: Number(get("status", "status") ?? 0),
  };
}

/** Decode a `MarketTwo` account and return its `vault` address. */
export function decodeExponentMarketVault(data: Buffer): PublicKey {
  const d = EXPONENT_ACCOUNTS_CODER.decode("MarketTwo", data) as Record<string, unknown>;
  return pk(d.vault);
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
