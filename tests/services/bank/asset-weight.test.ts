import { BigNumber } from "bignumber.js";
import { describe, expect, it } from "vitest";

import { MarginRequirementType } from "~/services/account";
import { BankType, getAssetWeight, OperationalState, RiskTier } from "~/services/bank";
import { OraclePrice } from "~/services/price";

const bank = (kaminoEmergency: boolean) =>
  ({
    kaminoEmergency,
    config: {
      riskTier: RiskTier.Collateral,
      operationalState: OperationalState.Operational,
      assetWeightInit: new BigNumber(0.8),
      assetWeightMaint: new BigNumber(0.9),
      totalAssetValueInitLimit: new BigNumber(0),
    },
  }) as unknown as BankType;

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
