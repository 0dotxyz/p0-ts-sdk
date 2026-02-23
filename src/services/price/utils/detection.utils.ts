import { BankType, OracleSetup } from "~/services/bank";

const ORACLE_SOURCES = {
  switchboard: "Switchboard",
  pyth: "Pyth",
  fixed: "Fixed",
  unknown: "Unknown",
} as const;

export type OracleSourceKey = keyof typeof ORACLE_SOURCES;

/**
 * Gets the oracle source from a oracle source key
 * @param oracleSourceKey - The oracle source key
 * @returns The oracle source name
 */
export function getOracleSourceNameFromKey(oracleSourceKey: string): string {
  return ORACLE_SOURCES[oracleSourceKey as OracleSourceKey] || oracleSourceKey;
}

/**
 * Gets the venue from a bank
 * @param bank - The bank to get the venue from
 * @returns The venue
 */
export function getOracleSourceFromBank(bank: BankType): {
  key: OracleSourceKey;
  name: string;
} {
  return getOracleSourceFromOracleSetup(bank.config.oracleSetup);
}

export function getOracleSourceFromOracleSetup(oracleSetup: OracleSetup) {
  let oracleSourceKey: OracleSourceKey;

  switch (oracleSetup) {
    case OracleSetup.SwitchboardPull ||
      OracleSetup.DriftSwitchboardPull ||
      OracleSetup.KaminoSwitchboardPull ||
      OracleSetup.JuplendSwitchboardPull ||
      OracleSetup.SolendSwitchboardPull:
      oracleSourceKey = "switchboard";
      break;
    case OracleSetup.PythPushOracle ||
      OracleSetup.StakedWithPythPush ||
      OracleSetup.KaminoPythPush ||
      OracleSetup.DriftPythPull ||
      OracleSetup.SolendPythPull ||
      OracleSetup.JuplendPythPull:
      oracleSourceKey = "pyth";
      break;
    case OracleSetup.Fixed ||
      OracleSetup.FixedKamino ||
      OracleSetup.FixedDrift ||
      OracleSetup.FixedJuplend ||
      OracleSetup.DriftPythPull ||
      OracleSetup.JuplendPythPull:
      oracleSourceKey = "fixed";
      break;
    default:
      oracleSourceKey = "unknown";
      break;
  }

  return {
    key: oracleSourceKey,
    name: ORACLE_SOURCES[oracleSourceKey],
  };
}
