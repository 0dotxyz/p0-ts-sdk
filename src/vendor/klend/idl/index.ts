import { KaminoLending } from "./klend";
import { Farms } from "./kfarms";
import KLEND_IDL_JSON from "./klend.json";
import KFARMS_IDL_JSON from "./kfarms.json";

export const KLEND_IDL = KLEND_IDL_JSON as KaminoLending;
export const KFARMS_IDL = KFARMS_IDL_JSON as Farms;
export type KlendIdlType = KaminoLending;
export type KfarmsIdlType = Farms;
