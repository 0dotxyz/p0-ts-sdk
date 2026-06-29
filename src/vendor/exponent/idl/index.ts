import EXPONENT_CORE_IDL_JSON from "./exponent_core.json";
import EXPONENT_CLMM_IDL_JSON from "./exponent_clmm.json";

/**
 * Raw Exponent core IDL (as committed in github.com/exponent-finance/exponent-core).
 * Kept for reference / future codegen. NOTE: its `address` field is the IDL-declared
 * program id, which differs from the live deployment — see `../constants.ts`.
 */
export const EXPONENT_CORE_IDL = EXPONENT_CORE_IDL_JSON;

/**
 * Raw Exponent CLMM IDL (`@exponent-labs/exponent-clmm-idl`, program `XPC1MM…` /
 * "MarketThree"). Used to Borsh-decode the `MarketThree` pool account; its `address`
 * field is the live CLMM program id. The matured-PT roll buys the successor PT directly
 * on this PT/SY CLMM via `trade_pt` (SY → PT), with no base round-trip or aggregator.
 */
export const EXPONENT_CLMM_IDL = EXPONENT_CLMM_IDL_JSON;
