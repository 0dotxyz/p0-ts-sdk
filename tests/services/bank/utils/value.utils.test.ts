import { BigNumber } from "bignumber.js";
import { describe, expect, it } from "vitest";

import { MarginRequirementType } from "~/services/account";
import {
  BankType,
  getAssetWeight,
  getBankLiquidationFees,
  OperationalState,
  RiskTier,
  withKaminoReserveEmergency,
} from "~/services/bank";
import { OraclePrice } from "~/services/price";
import { KaminoReserve } from "~/vendor/klend";

const bank = (kaminoEmergency: boolean, operationalState = OperationalState.Operational) =>
  ({
    kaminoEmergency,
    config: {
      riskTier: RiskTier.Collateral,
      operationalState,
      assetWeightInit: new BigNumber(0.8),
      assetWeightMaint: new BigNumber(0.9),
      totalAssetValueInitLimit: new BigNumber(0),
    },
  }) as unknown as BankType;

const reserve = (emergencyMode: number) =>
  ({ config: { emergencyMode } }) as unknown as KaminoReserve;

const oraclePrice = {} as OraclePrice;

describe("getAssetWeight", () => {
  it("gives a Kamino bank in emergency mode zero initial weight and keeps its maintenance weight", () => {
    const params = { bank: bank(true), oraclePrice };

    expect(getAssetWeight({ ...params, marginRequirement: MarginRequirementType.Initial })).toEqual(
      new BigNumber(0)
    );
    expect(
      getAssetWeight({ ...params, marginRequirement: MarginRequirementType.Maintenance })
    ).toEqual(new BigNumber(0.9));
  });

  it("gives a paused bank zero initial weight and keeps its maintenance weight", () => {
    const params = { bank: bank(false, OperationalState.Paused), oraclePrice };

    expect(getAssetWeight({ ...params, marginRequirement: MarginRequirementType.Initial })).toEqual(
      new BigNumber(0)
    );
    expect(
      getAssetWeight({ ...params, marginRequirement: MarginRequirementType.Maintenance })
    ).toEqual(new BigNumber(0.9));
  });

  it("keeps the initial weight outside emergency mode", () => {
    expect(
      getAssetWeight({
        bank: bank(false),
        oraclePrice,
        marginRequirement: MarginRequirementType.Initial,
      })
    ).toEqual(new BigNumber(0.8));
  });
});

describe("withKaminoReserveEmergency", () => {
  it("sets kaminoEmergency when the reserve is in emergency mode", () => {
    expect(withKaminoReserveEmergency(bank(false), reserve(1)).kaminoEmergency).toBe(true);
  });

  it("keeps the market's emergency when the reserve is normal", () => {
    expect(withKaminoReserveEmergency(bank(true), reserve(0)).kaminoEmergency).toBe(true);
  });

  it("leaves kaminoEmergency unset when neither is in emergency", () => {
    expect(withKaminoReserveEmergency(bank(false), reserve(0)).kaminoEmergency).toBe(false);
  });
});

describe("getBankLiquidationFees", () => {
  const feeBank = (liquidationLiquidatorFee: number, liquidationInsuranceFee: number) =>
    ({ liquidationLiquidatorFee, liquidationInsuranceFee }) as unknown as BankType;

  it("falls back to the 2.5% default for a stored 0", () => {
    const { liquidatorFee, insuranceFee } = getBankLiquidationFees(feeBank(0, 0));
    expect(liquidatorFee).toEqual(new BigNumber(0.025));
    expect(insuranceFee).toEqual(new BigNumber(0.025));
  });

  it("decodes the u32 encoding (u32::MAX = 100%)", () => {
    const { liquidatorFee, insuranceFee } = getBankLiquidationFees(
      feeBank(0xffffffff, Math.round(0xffffffff * 0.01))
    );
    expect(liquidatorFee.toNumber()).toBe(1);
    expect(insuranceFee.toNumber()).toBeCloseTo(0.01, 9);
  });
});
