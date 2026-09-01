import BigNumber from "bignumber.js";
import { PublicKey } from "@solana/web3.js";

export const MARINADE_PROGRAM_ID = new PublicKey("MarBmsSgKXdrN1egZf5sqe1TMai9K1rChYNDJgjq7aD");

// sha256("account:State")[..8]
export const MARINADE_STATE_DISCRIMINATOR = Buffer.from([216, 146, 107, 94, 104, 75, 182, 177]);

// msol_price (u64, mSOL/SOL rate scaled by 2^32) sits at struct offset 504 after the 8-byte
// discriminator. The real mainnet State account is larger (~2616 bytes); only the prefix through
// msol_price is read, mirroring the program's minimal view.
export const MARINADE_STATE_MIN_SIZE = 520;
const MSOL_PRICE_OFFSET = 512;
const MSOL_PRICE_PRECISION = new BigNumber(2).pow(32);

// Same sanity ceiling as the program's MAX_LST_SOL_RATE
const MAX_MSOL_SOL_RATE = 200;

export interface MarinadeState {
  /** mSOL/SOL exchange rate */
  msolPrice: BigNumber;
}

export function decodeMarinadeState(data: Buffer): MarinadeState {
  if (data.length < MARINADE_STATE_MIN_SIZE) {
    throw new Error(`Invalid Marinade State account size: ${data.length}`);
  }
  if (!data.subarray(0, 8).equals(MARINADE_STATE_DISCRIMINATOR)) {
    throw new Error("Invalid Marinade State discriminator");
  }

  const msolPriceRaw = data.readBigUInt64LE(MSOL_PRICE_OFFSET);
  const msolPrice = new BigNumber(msolPriceRaw.toString()).div(MSOL_PRICE_PRECISION);

  if (!msolPrice.gt(0) || msolPrice.gte(MAX_MSOL_SOL_RATE)) {
    throw new Error(`Marinade mSOL/SOL rate out of bounds: ${msolPrice.toString()}`);
  }

  return { msolPrice };
}
