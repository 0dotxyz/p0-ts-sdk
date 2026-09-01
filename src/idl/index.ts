import { Marginfi as MarginfiIdlTypeV0_1_10 } from "./marginfi-types_0.1.10";
import MARGINFI_IDL_V0_1_10_JSON from "./marginfi_0.1.10.json";

// TODO(idl-regen): both IDL files carry hand-applied edits for the upcoming oracle changes
// (marginfi-v2 #661/#631): OracleSetup variants 18-26, BankConfig._padding0 -> scope_entry_index,
// and the Scope errors 6700-6703. The JSON additionally pads OracleSetup with Reserved27-63 so
// borsh decode never throws on a future variant; the padding is deliberately NOT mirrored in the
// TS types file (it blows past TypeScript's type-instantiation depth on `program.account.*`).
// Once those PRs merge, regenerate the pair from the program repo (anchor idl build -p marginfi
// + address patch), re-apply the JSON padding, and diff against the hand edits.

export const MARGINFI_IDL = MARGINFI_IDL_V0_1_10_JSON as MarginfiIdlType;
export type MarginfiIdlType = MarginfiIdlTypeV0_1_10;
