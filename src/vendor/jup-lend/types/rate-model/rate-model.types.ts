/**
 * Curated RateModel used throughout the codebase.
 *
 * Interest-rate curve parameters (all bps values).
 */
export interface JupRateModel {
  version: number;
  rateAtZero: number;
  kink1Utilization: number;
  rateAtKink1: number;
  rateAtMax: number;
  kink2Utilization: number;
  rateAtKink2: number;
}
