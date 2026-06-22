import EXPONENT_CORE_IDL_JSON from "./exponent_core.json";

/**
 * Raw Exponent core IDL (as committed in github.com/exponent-finance/exponent-core).
 * Kept for reference / future codegen. NOTE: its `address` field is the IDL-declared
 * program id, which differs from the live deployment — see `../constants.ts`.
 */
export const EXPONENT_CORE_IDL = EXPONENT_CORE_IDL_JSON;
