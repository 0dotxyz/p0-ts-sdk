import { address } from "@solana/kit";
import { describe, it, expect } from "vitest";

import { BANK_DISCRIMINATOR, decodeBankRaw, OracleSetupRaw } from "~/accounts";
import { CIRCUIT_BREAKER_ENABLED_FLAG } from "~/constants";
import { OracleSetup } from "~/services/bank/types";
import {
  dtoToBank,
  parseBankConfigRaw,
  parseBankRaw,
  parseOracleSetup,
} from "~/services/bank/utils/deserialize.utils";
import { serializeOracleSetup, toBankDto } from "~/services/bank/utils/serialize.utils";

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
  [OracleSetup.ScopeKamino, 27],
  [OracleSetup.ScopeJuplend, 28],
];

describe("OracleSetup (de)serialization", () => {
  it("maps every real variant to its on-chain discriminant and back", () => {
    for (const [setup, index] of SETUP_INDICES) {
      expect(serializeOracleSetup(setup)).toBe(index);
      expect(parseOracleSetup(index)).toBe(setup);
    }
  });

  it("parses future (reserved) discriminants as Unknown instead of throwing", () => {
    for (const index of [OracleSetupRaw.Reserved29, OracleSetupRaw.Reserved40, 63]) {
      expect(parseOracleSetup(index)).toBe(OracleSetup.Unknown);
    }
  });

  it("refuses to serialize Unknown", () => {
    expect(() => serializeOracleSetup(OracleSetup.Unknown)).toThrow(
      'Invalid oracle setup "Unknown"'
    );
  });
});

describe("scopeEntryIndex plumbing", () => {
  // A zeroed Bank account (discriminator + zero bytes) decodes to a config with every field at 0.
  const zeroConfig = () => {
    const data = new Uint8Array(4096);
    data.set(BANK_DISCRIMINATOR);
    return decodeBankRaw(data).config;
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

describe("liquidation fee and circuit breaker plumbing", () => {
  const BANK_ADDRESS = address("11111111111111111111111111111111");
  const zeroBank = () => {
    const data = new Uint8Array(4096);
    data.set(BANK_DISCRIMINATOR);
    return decodeBankRaw(data);
  };

  it("parses the raw fees, the breaker flag and its halt state", () => {
    const raw = zeroBank();
    const bank = parseBankRaw(BANK_ADDRESS, {
      ...raw,
      flags: BigInt(CIRCUIT_BREAKER_ENABLED_FLAG),
      liquidationLiquidatorFee: 123,
      liquidationInsuranceFee: 456,
      cbTier: 2,
      cbHaltEndedAt: 1_800_000_000n,
      config: {
        ...raw.config,
        cbWindowMaxUpBps: 300,
        cbWindowMaxDownBps: 250,
        cbWindowSeconds: 86400,
      },
    });

    expect(bank.liquidationLiquidatorFee).toBe(123);
    expect(bank.liquidationInsuranceFee).toBe(456);
    expect(bank.isCircuitBreakerEnabled).toBe(true);
    expect(bank.cbTier).toBe(2);
    expect(bank.cbHaltEndedAt).toBe(1_800_000_000);
    expect(bank.config.cbWindowMaxUpBps).toBe(300);
    expect(bank.config.cbWindowMaxDownBps).toBe(250);
    expect(bank.config.cbWindowSeconds).toBe(86400);
  });

  it("defaults the fields on DTOs serialized before they existed", () => {
    const dto = toBankDto(parseBankRaw(BANK_ADDRESS, zeroBank()));
    /* eslint-disable @typescript-eslint/no-unused-vars */
    const {
      liquidationLiquidatorFee,
      liquidationInsuranceFee,
      isCircuitBreakerEnabled,
      cbTier,
      cbHaltEndedAt,
      ...oldDto
    } = dto;
    const { cbWindowMaxUpBps, cbWindowMaxDownBps, cbWindowSeconds, ...oldConfig } = dto.config;
    /* eslint-enable @typescript-eslint/no-unused-vars */

    const bank = dtoToBank({ ...oldDto, config: oldConfig });

    expect(bank.liquidationLiquidatorFee).toBe(0);
    expect(bank.liquidationInsuranceFee).toBe(0);
    expect(bank.isCircuitBreakerEnabled).toBe(false);
    expect(bank.cbTier).toBe(0);
    expect(bank.cbHaltEndedAt).toBe(0);
    expect(bank.config.cbWindowSeconds).toBe(0);
  });
});
