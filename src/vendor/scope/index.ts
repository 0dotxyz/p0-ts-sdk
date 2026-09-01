import BigNumber from "bignumber.js";
import { PublicKey } from "@solana/web3.js";

export const SCOPE_PROGRAM_ID = new PublicKey("HFn8GnPADiny6XqUoWE8uRPPxb29ikn4yTuPa9MF2fWJ");

// sha256("account:OraclePrices")[..8]
export const SCOPE_ORACLE_PRICES_DISCRIMINATOR = Buffer.from([89, 128, 118, 221, 6, 72, 180, 146]);

export const SCOPE_MAX_ENTRIES = 512;

// OraclePrices layout: 8 (discriminator) + 32 (oracle_mappings) + 512 * 56 (DatedPrice entries)
const ENTRIES_OFFSET = 40;
const DATED_PRICE_SIZE = 56;
export const SCOPE_ORACLE_PRICES_SIZE = ENTRIES_OFFSET + SCOPE_MAX_ENTRIES * DATED_PRICE_SIZE;

export interface ScopeDatedPrice {
  /** Decimal price, i.e. `value / 10^exp` */
  price: BigNumber;
  lastUpdatedSlot: number;
  unixTimestamp: number;
}

/**
 * Decodes one `DatedPrice` entry out of a Scope `OraclePrices` account.
 * DatedPrice layout: price.value u64, price.exp u64, last_updated_slot u64, unix_timestamp u64,
 * generic_data [u8; 24].
 */
export function decodeScopePriceAtIndex(data: Buffer, entryIndex: number): ScopeDatedPrice {
  if (data.length !== SCOPE_ORACLE_PRICES_SIZE) {
    throw new Error(`Invalid Scope OraclePrices account size: ${data.length}`);
  }
  if (!data.subarray(0, 8).equals(SCOPE_ORACLE_PRICES_DISCRIMINATOR)) {
    throw new Error("Invalid Scope OraclePrices discriminator");
  }
  if (entryIndex < 0 || entryIndex >= SCOPE_MAX_ENTRIES) {
    throw new Error(`Scope entry index out of range: ${entryIndex}`);
  }

  const offset = ENTRIES_OFFSET + entryIndex * DATED_PRICE_SIZE;
  const value = data.readBigUInt64LE(offset);
  const exp = data.readBigUInt64LE(offset + 8);
  const lastUpdatedSlot = data.readBigUInt64LE(offset + 16);
  const unixTimestamp = data.readBigUInt64LE(offset + 24);

  // Same bound as the program's MAX_EXP_10_I80F48
  if (exp >= 24n) {
    throw new Error(`Scope entry exponent out of bounds: ${exp}`);
  }

  const price = new BigNumber(value.toString()).shiftedBy(-Number(exp));

  return {
    price,
    lastUpdatedSlot: Number(lastUpdatedSlot),
    unixTimestamp: Number(unixTimestamp),
  };
}
