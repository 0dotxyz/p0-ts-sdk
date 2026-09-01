import { describe, it, expect } from "vitest";
import { BorshCoder } from "@coral-xyz/anchor";

import { MARGINFI_IDL } from "~/idl";
import { OracleSetup } from "~/services/bank";
import { parseOracleSetup, parseBankConfigRaw } from "~/services/bank/utils/deserialize.utils";
import {
  serializeOracleSetup,
  serializeOracleSetupToIndex,
} from "~/services/bank/utils/serialize.utils";

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

const typesCoder = new BorshCoder(MARGINFI_IDL as any).types;

describe("OracleSetup (de)serialization", () => {
  it("round-trips every real variant through raw and index", () => {
    for (const [setup, index] of SETUP_INDICES) {
      expect(parseOracleSetup(serializeOracleSetup(setup))).toBe(setup);
      expect(serializeOracleSetupToIndex(setup)).toBe(index);
    }
  });

  it("round-trips every real variant through the IDL borsh coder", () => {
    for (const [setup, index] of SETUP_INDICES) {
      const decoded = typesCoder.decode("OracleSetup", Buffer.from([index]));
      expect(parseOracleSetup(decoded)).toBe(setup);
    }
  });

  it("parses the fixed venue variants (regression: dead PascalCase cases)", () => {
    expect(parseOracleSetup({ fixedKamino: {} })).toBe(OracleSetup.FixedKamino);
    expect(parseOracleSetup({ fixedDrift: {} })).toBe(OracleSetup.FixedDrift);
    expect(parseOracleSetup({ fixedJuplend: {} })).toBe(OracleSetup.FixedJuplend);
  });

  it("decodes future discriminants via the reserved padding instead of throwing", () => {
    for (const index of [27, 40, 63]) {
      const decoded = typesCoder.decode("OracleSetup", Buffer.from([index]));
      expect(parseOracleSetup(decoded)).toBe(OracleSetup.Unknown);
    }
  });

  it("refuses to serialize Unknown", () => {
    expect(() => serializeOracleSetup(OracleSetup.Unknown)).toThrow();
    expect(() => serializeOracleSetupToIndex(OracleSetup.Unknown)).toThrow();
  });
});

describe("scopeEntryIndex plumbing", () => {
  const baseConfigRaw = () => {
    // Minimal BankConfigRaw: only the fields parseBankConfigRaw touches.
    const i80 = { value: new Array(16).fill(0) };
    const bnLike = { toString: () => "0" } as any;
    return {
      assetWeightInit: i80,
      assetWeightMaint: i80,
      liabilityWeightInit: i80,
      liabilityWeightMaint: i80,
      depositLimit: bnLike,
      borrowLimit: bnLike,
      riskTier: { collateral: {} },
      operationalState: { operational: {} },
      totalAssetValueInitLimit: bnLike,
      assetTag: 0,
      configFlags: 0,
      oracleSetup: { scope: {} },
      oracleKeys: [],
      oracleMaxAge: 60,
      oracleMaxConfidence: 0,
      fixedPrice: i80,
      interestRateConfig: {
        placeholder0: i80,
        placeholder1: i80,
        placeholder2: i80,
        insuranceFeeFixedApr: i80,
        insuranceIrFee: i80,
        protocolFixedFeeApr: i80,
        protocolIrFee: i80,
        protocolOriginationFee: i80,
        zeroUtilRate: 0,
        hundredUtilRate: 0,
        points: [],
        curveType: 0,
      },
    } as any;
  };

  it("passes scopeEntryIndex through parseBankConfigRaw", () => {
    const parsed = parseBankConfigRaw({ ...baseConfigRaw(), scopeEntryIndex: 42 });
    expect(parsed.oracleSetup).toBe(OracleSetup.Scope);
    expect(parsed.scopeEntryIndex).toBe(42);
  });

  it("defaults scopeEntryIndex to 0 for payloads decoded with an older IDL", () => {
    const parsed = parseBankConfigRaw(baseConfigRaw());
    expect(parsed.scopeEntryIndex).toBe(0);
  });

  it("keeps oracleMaxAge 0 for Scope banks (no 0 -> default fallback on-chain)", () => {
    const scopeConfig = { ...baseConfigRaw(), oracleMaxAge: 0 };
    expect(parseBankConfigRaw(scopeConfig).oracleMaxAge).toBe(0);

    const pythConfig = {
      ...baseConfigRaw(),
      oracleSetup: { pythPushOracle: {} },
      oracleMaxAge: 0,
    };
    expect(parseBankConfigRaw(pythConfig).oracleMaxAge).toBeGreaterThan(0);
  });
});
