import BigNumber from "bignumber.js";
import { PublicKey } from "@solana/web3.js";

export const MARINADE_PROGRAM_ID = new PublicKey("MarBmsSgKXdrN1egZf5sqe1TMai9K1rChYNDJgjq7aD");

// State: 8-byte discriminator + 512-byte struct; msol_price (u64, mSOL/SOL rate scaled by 2^32)
// sits at struct offset 504.
export const MARINADE_STATE_SIZE = 520;
const MSOL_PRICE_OFFSET = 512;
const MSOL_PRICE_PRECISION = new BigNumber(2).pow(32);

export interface MarinadeState {
  /** mSOL/SOL exchange rate */
  msolPrice: BigNumber;
}

export function decodeMarinadeState(data: Buffer): MarinadeState {
  if (data.length !== MARINADE_STATE_SIZE) {
    throw new Error(`Invalid Marinade State account size: ${data.length}`);
  }

  const msolPriceRaw = data.readBigUInt64LE(MSOL_PRICE_OFFSET);

  return {
    msolPrice: new BigNumber(msolPriceRaw.toString()).div(MSOL_PRICE_PRECISION),
  };
}
