import { BigNumber } from "bignumber.js";

import type { PreciseNumber } from "~/generated/exponent-core";

/** Converts an Exponent `PreciseNumber` (little-endian U256 words, scaled by 1e12) to a BigNumber. */
export function exponentNumberToBigNumber([words]: PreciseNumber): BigNumber {
  const value = words.reduce((sum, word, i) => sum + (word << (64n * BigInt(i))), 0n);
  return new BigNumber(value.toString()).div(1e12);
}
