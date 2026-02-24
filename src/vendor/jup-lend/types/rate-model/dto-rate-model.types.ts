/**
 * JSON-serializable DTO for the RateModel account.
 * PublicKey → string.
 */
export interface JupRateModelJSON {
  pubkey: string;
  mint: string;
  version: number;
  rateAtZero: number;
  kink1Utilization: number;
  rateAtKink1: number;
  rateAtMax: number;
  kink2Utilization: number;
  rateAtKink2: number;
}
