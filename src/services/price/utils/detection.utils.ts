import { BankType, OracleSetup } from "~/services/bank";

const ORACLE_SOURCES = {
  switchboard: "Switchboard",
  pyth: "Pyth",
  fixed: "Fixed",
  scope: "Scope",
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
    case OracleSetup.SwitchboardPull:
    case OracleSetup.SwitchboardV2:
    case OracleSetup.DriftSwitchboardPull:
    case OracleSetup.KaminoSwitchboardPull:
    case OracleSetup.JuplendSwitchboardPull:
    case OracleSetup.SolendSwitchboardPull:
      oracleSourceKey = "switchboard";
      break;
    case OracleSetup.PythPushOracle:
    case OracleSetup.PythLegacy:
    case OracleSetup.StakedWithPythPush:
    case OracleSetup.KaminoPythPush:
    case OracleSetup.DriftPythPull:
    case OracleSetup.SolendPythPull:
    case OracleSetup.JuplendPythPull:
    case OracleSetup.PythMSOL:
    case OracleSetup.KaminoMSOL:
    case OracleSetup.JuplendMSOL:
    case OracleSetup.PythLST:
    case OracleSetup.KaminoLST:
    case OracleSetup.JuplendLST:
    case OracleSetup.PTPyth:
      oracleSourceKey = "pyth";
      break;
    case OracleSetup.Fixed:
    case OracleSetup.FixedKamino:
    case OracleSetup.FixedDrift:
    case OracleSetup.FixedJuplend:
    case OracleSetup.PTFixed:
      oracleSourceKey = "fixed";
      break;
    case OracleSetup.Scope:
      oracleSourceKey = "scope";
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
