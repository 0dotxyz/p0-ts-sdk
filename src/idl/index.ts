import { Marginfi as MarginfiIdlTypeV0_1_10 } from "./marginfi-types_0.1.10";
import MARGINFI_IDL_V0_1_10_JSON from "./marginfi_0.1.10.json";

export const MARGINFI_IDL = MARGINFI_IDL_V0_1_10_JSON as MarginfiIdlType;
export type MarginfiIdlType = MarginfiIdlTypeV0_1_10;

export {
  type MarginfiProgramVersion,
  MARGINFI_GROUP_SIZES,
  detectMarginfiProgramVersion,
  detectProgramVersionFromGroupData,
  getMarginfiLegacyIdl,
  isLegacyMarginfiProgram,
  marginfiIdlFor,
} from "./legacy";
