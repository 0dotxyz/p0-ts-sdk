import { containsBytes, type ReadonlyUint8Array } from "@solana/kit";
import BigNumber from "bignumber.js";

import {
  getDatedPriceDecoder,
  getOraclePricesSize,
  ORACLE_PRICES_DISCRIMINATOR,
} from "~/generated/scope";

export { SCOPE_PROGRAM_ADDRESS } from "~/generated/scope";

/** Price entries in a Scope `OraclePrices` account. */
export const SCOPE_MAX_ENTRIES = 512;

// OraclePrices layout: 8 (discriminator) + 32 (oracle_mappings) + 512 × 56 (DatedPrice entries)
const ENTRIES_OFFSET = 40;
const DATED_PRICE_SIZE = 56;

export interface ScopeDatedPrice {
  /** Decimal price, i.e. `value / 10^exp` */
  price: BigNumber;
  lastUpdatedSlot: number;
  unixTimestamp: number;
}

/**
 * Decodes entry `entryIndex` of a Scope `OraclePrices` account. A never-refreshed entry reads as a
 * zero price.
 * @throws if the account has the wrong size or discriminator, the index is out of range, or the
 * exponent is past the program's power-of-ten table (≥ 24)
 */
export function decodeScopePriceAtIndex(
  data: ReadonlyUint8Array,
  entryIndex: number
): ScopeDatedPrice {
  if (data.length !== getOraclePricesSize()) {
    throw new Error(`Invalid Scope OraclePrices account size: ${data.length}`);
  }
  if (entryIndex < 0 || entryIndex >= SCOPE_MAX_ENTRIES) {
    throw new Error(`Scope entry index out of range: ${entryIndex}`);
  }

  if (!containsBytes(data, ORACLE_PRICES_DISCRIMINATOR, 0)) {
    throw new Error("Invalid Scope OraclePrices account discriminator");
  }

  // Decode only the requested entry rather than all 512.
  const { price, lastUpdatedSlot, unixTimestamp } = getDatedPriceDecoder().decode(
    data,
    ENTRIES_OFFSET + entryIndex * DATED_PRICE_SIZE
  );

  // Same bound as the program's MAX_EXP_10_I80F48
  if (price.exp >= 24n) {
    throw new Error(`Scope entry exponent out of bounds: ${price.exp}`);
  }

  return {
    price: new BigNumber(price.value.toString()).shiftedBy(-Number(price.exp)),
    lastUpdatedSlot: Number(lastUpdatedSlot),
    unixTimestamp: Number(unixTimestamp),
  };
}
