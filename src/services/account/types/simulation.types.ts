import { BankType } from "~/services/bank";
import { MarginfiAccountType } from "./account.types";

export interface SimulationResultRaw {
  marginfiAccount: MarginfiAccountType;
  banks: BankType[];
}

/**
 * Custom error class for health cache simulation failures
 */
export class HealthCacheSimulationError extends Error {
  mrgnErr: number | null;
  internalErr: number | null;

  constructor(message: string, mrgnErr: number | null, internalErr: number | null) {
    super(message);
    this.name = "HealthCacheSimulationError";
    this.mrgnErr = mrgnErr;
    this.internalErr = internalErr;

    // Maintains proper stack trace for where our error was thrown (only available on V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, HealthCacheSimulationError);
    }
  }
}
