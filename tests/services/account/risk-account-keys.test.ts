import { describe, it, expect } from "vitest";
import { PublicKey } from "@solana/web3.js";

import { computeBankRiskAccountKeys } from "~/services/account/utils/compute/transaction-projection.utils";
import { AssetTag, BankType, OracleSetup } from "~/services/bank";

const KEYS = Array.from({ length: 5 }, () => PublicKey.unique());

function bank(opts: {
  oracleSetup: OracleSetup;
  assetTag: AssetTag;
  oracleKeys?: PublicKey[];
}): BankType {
  const oracleKeys = opts.oracleKeys ?? KEYS;
  return {
    address: PublicKey.unique(),
    oracleKey: oracleKeys[0],
    config: {
      oracleSetup: opts.oracleSetup,
      assetTag: opts.assetTag,
      oracleKeys,
    },
  } as unknown as BankType;
}

describe("computeBankRiskAccountKeys", () => {
  it("keeps the default [bank, oracle] shape for plain pyth banks (regression)", () => {
    const b = bank({ oracleSetup: OracleSetup.PythPushOracle, assetTag: AssetTag.DEFAULT });
    expect(computeBankRiskAccountKeys(b)).toEqual([b.address, KEYS[0]]);
  });

  it("keeps the venue [bank, oracle, keys[1]] shape for kamino banks (regression)", () => {
    const b = bank({ oracleSetup: OracleSetup.KaminoPythPush, assetTag: AssetTag.KAMINO });
    expect(computeBankRiskAccountKeys(b)).toEqual([b.address, KEYS[0], KEYS[1]]);
  });

  it("appends the pricing account at keys[1] for plain multiplier setups", () => {
    for (const oracleSetup of [OracleSetup.PythMSOL, OracleSetup.PythLST, OracleSetup.PTPyth]) {
      const b = bank({ oracleSetup, assetTag: AssetTag.DEFAULT });
      expect(computeBankRiskAccountKeys(b)).toEqual([b.address, KEYS[0], KEYS[1]]);
    }
  });

  it("appends the pricing account at keys[2] after the venue account for venue multiplier setups", () => {
    const venueCases: [OracleSetup, AssetTag][] = [
      [OracleSetup.KaminoMSOL, AssetTag.KAMINO],
      [OracleSetup.KaminoLST, AssetTag.KAMINO],
      [OracleSetup.JuplendMSOL, AssetTag.JUPLEND],
      [OracleSetup.JuplendLST, AssetTag.JUPLEND],
    ];
    for (const [oracleSetup, assetTag] of venueCases) {
      const b = bank({ oracleSetup, assetTag });
      expect(computeBankRiskAccountKeys(b)).toEqual([b.address, KEYS[0], KEYS[1], KEYS[2]]);
    }
  });

  it("needs no extra accounts for Scope and PTFixed", () => {
    for (const oracleSetup of [OracleSetup.Scope, OracleSetup.PTFixed]) {
      const b = bank({ oracleSetup, assetTag: AssetTag.DEFAULT });
      expect(computeBankRiskAccountKeys(b)).toEqual([b.address, KEYS[0]]);
    }
  });
});
