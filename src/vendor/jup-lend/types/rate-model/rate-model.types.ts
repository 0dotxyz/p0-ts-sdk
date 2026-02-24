import { PublicKey } from "@solana/web3.js";

/**
 * Curated RateModel — identical to raw since all fields are primitives + PublicKey.
 */
export interface JupRateModel {
  pubkey: PublicKey;
  mint: PublicKey;
  version: number;
  rateAtZero: number;
  kink1Utilization: number;
  rateAtKink1: number;
  rateAtMax: number;
  kink2Utilization: number;
  rateAtKink2: number;
}
