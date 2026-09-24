import { describe, it, expect } from "vitest";

import { BANK_DISCRIMINATOR, decodeBank, OracleSetupRaw } from "~/accounts";
import { OracleSetup } from "~/services/bank/types";
import { parseOracleSetup, parseBankConfigRaw } from "~/services/bank/utils/deserialize.utils";
import { serializeOracleSetup } from "~/services/bank/utils/serialize.utils";

/** Every real (non-reserved) variant with its confirmed on-chain discriminant. */
const SETUP_INDICES: [OracleSetup, number][] = [
  [OracleSetup.None, 0],
  [OracleSetup.PythLegacy, 1],
  [OracleSetup.SwitchboardV2, 2],
  [OracleSetup.PythPushOracle, 3],
  [OracleSetup.SwitchboardPull, 4],
  [OracleSetup.StakedWithPythPush, 5],
  [OracleSetup.KaminoPythPush, 6],
  [OracleSetup.KaminoSwitchboardPull, 7],
  [OracleSetup.Fixed, 8],
  [OracleSetup.DriftPythPull, 9],
  [OracleSetup.DriftSwitchboardPull, 10],
  [OracleSetup.SolendPythPull, 11],
  [OracleSetup.SolendSwitchboardPull, 12],
  [OracleSetup.FixedKamino, 13],
  [OracleSetup.FixedDrift, 14],
  [OracleSetup.JuplendPythPull, 15],
  [OracleSetup.JuplendSwitchboardPull, 16],
  [OracleSetup.FixedJuplend, 17],
  [OracleSetup.Scope, 18],
  [OracleSetup.PythMSOL, 19],
  [OracleSetup.KaminoMSOL, 20],
  [OracleSetup.JuplendMSOL, 21],
  [OracleSetup.PythLST, 22],
  [OracleSetup.KaminoLST, 23],
  [OracleSetup.JuplendLST, 24],
  [OracleSetup.PTPyth, 25],
  [OracleSetup.PTFixed, 26],
];

describe("OracleSetup (de)serialization", () => {
  it("maps every real variant to its on-chain discriminant and back", () => {
    for (const [setup, index] of SETUP_INDICES) {
      expect(serializeOracleSetup(setup)).toBe(index);
      expect(parseOracleSetup(index)).toBe(setup);
    }
  });

  it("parses future (reserved) discriminants as Unknown instead of throwing", () => {
    for (const index of [OracleSetupRaw.Reserved27, OracleSetupRaw.Reserved40, 63]) {
      expect(parseOracleSetup(index)).toBe(OracleSetup.Unknown);
    }
  });

  it("refuses to serialize Unknown", () => {
    expect(() => serializeOracleSetup(OracleSetup.Unknown)).toThrow();
  });
});

describe("scopeEntryIndex plumbing", () => {
  // A zeroed Bank account (discriminator + zero bytes) decodes to a config with every field at 0.
  const zeroConfig = () => {
    const data = new Uint8Array(4096);
    data.set(BANK_DISCRIMINATOR);
    return decodeBank(data).config;
  };

  it("passes scopeEntryIndex through parseBankConfigRaw", () => {
    const parsed = parseBankConfigRaw({
      ...zeroConfig(),
      oracleSetup: OracleSetupRaw.Scope,
      scopeEntryIndex: 42,
    });
    expect(parsed.oracleSetup).toBe(OracleSetup.Scope);
    expect(parsed.scopeEntryIndex).toBe(42);
  });

  it("keeps oracleMaxAge 0 for Scope banks (no 0 -> default fallback on-chain)", () => {
    const scopeConfig = { ...zeroConfig(), oracleSetup: OracleSetupRaw.Scope, oracleMaxAge: 0 };
    expect(parseBankConfigRaw(scopeConfig).oracleMaxAge).toBe(0);

    const pythConfig = {
      ...zeroConfig(),
      oracleSetup: OracleSetupRaw.PythPushOracle,
      oracleMaxAge: 0,
    };
    expect(parseBankConfigRaw(pythConfig).oracleMaxAge).toBeGreaterThan(0);
  });
});
