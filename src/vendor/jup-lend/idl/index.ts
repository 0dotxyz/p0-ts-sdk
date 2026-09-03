import { JupLend } from "./jup-lend";
import { Liquidity } from "./jup-lend-liquidity";
import JUP_LIQUIDITY_IDL_JSON from "./jup-lend-liquidity.json";
import JUP_LEND_IDL_JSON from "./jup-lend.json";

export const JUP_LEND_IDL = JUP_LEND_IDL_JSON as unknown as JupLend;
export type JupLendIdlType = JupLend;

export const JUP_LIQUIDITY_IDL = JUP_LIQUIDITY_IDL_JSON as unknown as Liquidity;
export type JupLiquidityIdlType = Liquidity;
