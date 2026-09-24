import type { Address } from "@solana/kit";
import BigNumber from "bignumber.js";

import { OracleSetup } from "~/services/bank";

/**
 * What the multiplier computation needs per bank. Derived from the bank config by
 * `getOracleMultiplierBankInput`.
 */
export type OracleMultiplierBankInput = {
  bankAddress: Address;
  oracleSetup: OracleSetup;
  multiplierAccountKey: Address;
  /** PT start price; only read for PTPyth / PTFixed. */
  fixedPrice?: BigNumber;
};

/**
 * Decoded multiplier account, JSON-safe so an API route can return it as-is. Big values are
 * decimal strings.
 */
export type MultiplierAccountState =
  | { kind: "marinade"; msolPrice: string }
  | { kind: "stakePool"; exchangeRate: string; lastUpdateEpoch: number }
  | {
      kind: "exponentVault";
      startTs: number;
      duration: number;
      syForPt: string;
      ptSupply: string;
      lastSeenSyExchangeRate: string;
      allTimeHighSyExchangeRate: string;
    };

/** Decoded multiplier accounts keyed by account address, plus the epoch they were read at. */
export type MultiplierAccountStates = {
  states: Record<string, MultiplierAccountState>;
  currentEpoch: number;
};
