import { Marginfi as MarginfiIdlTypeV0_1_12 } from "./marginfi-types_0.1.12";
import MARGINFI_IDL_V0_1_12_JSON from "./marginfi_0.1.12.json";

// The JSON IDL pads OracleSetup with Reserved29-63 so borsh decode never throws on a future
// variant. The padding is deliberately not mirrored in the TS types file because it exceeds
// TypeScript's type-instantiation depth on `program.account.*`.

export const MARGINFI_IDL = MARGINFI_IDL_V0_1_12_JSON as MarginfiIdlType;
export type MarginfiIdlType = MarginfiIdlTypeV0_1_12;
