import { Marginfi as MarginfiIdlTypeV0_1_11 } from "./marginfi-types_0.1.11";
import MARGINFI_IDL_V0_1_11_JSON from "./marginfi_0.1.11.json";

// The JSON IDL pads OracleSetup with Reserved27-63 so borsh decode never throws on a future
// variant. The padding is deliberately not mirrored in the TS types file because it exceeds
// TypeScript's type-instantiation depth on `program.account.*`.

export const MARGINFI_IDL = MARGINFI_IDL_V0_1_11_JSON as MarginfiIdlType;
export type MarginfiIdlType = MarginfiIdlTypeV0_1_11;
