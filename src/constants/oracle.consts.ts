import { PublicKey } from "@solana/web3.js";
import BigNumber from "bignumber.js";

export const PYTH_PUSH_ORACLE_ID = new PublicKey("pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT");
export const PYTH_SPONSORED_SHARD_ID = 0;
export const MARGINFI_SPONSORED_SHARD_ID = 3301;

export const DEFAULT_ORACLE_MAX_AGE = 60; // seconds

export const ZERO_ORACLE_KEY = "DMhGWtLAKE5d56WdyHQxqeFncwUeqMEnuC2RvvZfbuur";

export const PYTH_PRICE_CONF_INTERVALS = new BigNumber(2.12);
export const SWB_PRICE_CONF_INTERVALS = new BigNumber(1.96);
export const MAX_CONFIDENCE_INTERVAL_RATIO = new BigNumber(0.05);
