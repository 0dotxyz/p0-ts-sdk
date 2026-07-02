/**
 * JSON-serializable DTO for the curated RateModel.
 */
export interface JupRateModelJSON {
  version: number;
  rateAtZero: number;
  kink1Utilization: number;
  rateAtKink1: number;
  rateAtMax: number;
  kink2Utilization: number;
  rateAtKink2: number;
}
