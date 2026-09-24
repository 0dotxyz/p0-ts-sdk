import type { ReadonlyUint8Array } from "@solana/kit";

import { decodeAccountData } from "../account-data";

import {
  getPriceUpdateV2Decoder,
  PRICE_UPDATE_V2_DISCRIMINATOR,
  type PriceUpdateV2,
} from "~/generated/pyth-receiver";

/**
 * Decodes a Pyth receiver `PriceUpdateV2` account (push oracle price feed).
 * @throws if the discriminator doesn't match
 */
export function decodePythPriceUpdate(data: ReadonlyUint8Array): PriceUpdateV2 {
  return decodeAccountData(
    data,
    PRICE_UPDATE_V2_DISCRIMINATOR,
    getPriceUpdateV2Decoder(),
    "Pyth PriceUpdateV2"
  );
}
