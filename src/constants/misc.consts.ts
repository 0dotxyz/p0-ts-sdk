import { address } from "@solana/kit";

export const HOURS_PER_YEAR = 365.25 * 24;

export const MAX_U64 = BigInt("18446744073709551615").toString();

/** The all-zero address (`Pubkey::default()`), used on-chain for unset account fields. */
export const DEFAULT_ADDRESS = address("11111111111111111111111111111111");
