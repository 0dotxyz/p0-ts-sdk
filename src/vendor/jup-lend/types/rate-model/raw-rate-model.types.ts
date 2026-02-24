import { PublicKey } from "@solana/web3.js";

/**
 * Raw on-chain RateModel account (bytemuck / packed C repr).
 *
 * This lives on the jup liquidity layer and contains the piecewise
 * linear interest rate curve parameters for a given token.
 *
 * V1 (version=1): single kink  — rateAtZero → rateAtKink1 → rateAtMax
 * V2 (version=2): dual kink    — rateAtZero → rateAtKink1 → rateAtKink2 → rateAtMax
 *
 * All rate/utilization values are in bps (100% = 10,000).
 */
export interface JupRateModelRaw {
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
