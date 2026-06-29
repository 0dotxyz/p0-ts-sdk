import { PublicKey } from "@solana/web3.js";

import {
  EXPONENT_CLMM_PROGRAM_ID,
  EXPONENT_CORE_PROGRAM_ID,
  EXPONENT_EVENT_AUTHORITY_SEED,
} from "../constants";

/** Derive the Anchor event-CPI authority PDA for the Exponent core program. */
export function deriveExponentEventAuthority(): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(EXPONENT_EVENT_AUTHORITY_SEED)],
    EXPONENT_CORE_PROGRAM_ID
  )[0];
}

/** Derive the Anchor event-CPI authority PDA for the Exponent CLMM (`MarketThree`) program. */
export function deriveExponentClmmEventAuthority(): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(EXPONENT_EVENT_AUTHORITY_SEED)],
    EXPONENT_CLMM_PROGRAM_ID
  )[0];
}
