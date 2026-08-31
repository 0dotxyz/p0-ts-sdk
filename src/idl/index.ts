import { Marginfi as MarginfiIdlTypeV0_1_10 } from "./marginfi-types_0.1.10";
import MARGINFI_IDL_V0_1_10_JSON from "./marginfi_0.1.10.json";

// TODO(idl-regen): both IDL files carry hand-applied edits for the upcoming oracle changes
// (marginfi-v2 #661/#631): OracleSetup variants 18-26 + Reserved27-63 padding (so borsh decode
// never throws on a future variant) and BankConfig._padding0 -> scope_entry_index. Once those
// PRs merge, regenerate the pair from the program repo (anchor idl build -p marginfi + address
// patch) and diff against the hand edits.

export const MARGINFI_IDL = MARGINFI_IDL_V0_1_10_JSON as MarginfiIdlType;
export type MarginfiIdlType = MarginfiIdlTypeV0_1_10;
