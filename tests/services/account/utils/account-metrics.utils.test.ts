import { getAddressDecoder } from "@solana/kit";
import { BigNumber } from "bignumber.js";
import { describe, expect, it } from "vitest";

import { HealthCacheStatus, MarginfiAccountType } from "~/services/account/types";
import { computeLiquidationPriceForBank } from "~/services/account/utils/account-metrics.utils";
import { AssetTag, BankType, OperationalState, RiskTier } from "~/services/bank/types";
import { OraclePrice } from "~/services/price/types";

const bankAddress = getAddressDecoder().decode(new Uint8Array(32).fill(1));

const bank = {
  address: bankAddress,
  mintDecimals: 9,
  assetShareValue: new BigNumber(1),
  liabilityShareValue: new BigNumber(1),
  config: {
    riskTier: RiskTier.Collateral,
    operationalState: OperationalState.Operational,
    assetTag: AssetTag.KAMINO,
    assetWeightInit: new BigNumber(0.8),
    assetWeightMaint: new BigNumber(0.9),
    liabilityWeightInit: new BigNumber(1.25),
    liabilityWeightMaint: new BigNumber(1.1),
    totalAssetValueInitLimit: new BigNumber(0),
  },
} as unknown as BankType;

// 100 ± 2
const price = {
  price: new BigNumber(100),
  confidence: new BigNumber(2),
  lowestPrice: new BigNumber(98),
  highestPrice: new BigNumber(102),
};
const oraclePrice = {
  priceRealtime: price,
  priceWeighted: price,
  timestamp: new BigNumber(0),
} as OraclePrice;

describe("computeLiquidationPriceForBank", () => {
  it("solves for the price where the low-biased collateral covers the debt", () => {
    // 10 cTokens worth 12 of the underlying, the account's only collateral, against $600 of debt
    const multiplier = new BigNumber(1.2);
    const collateralValue = 12 * 0.9 * 98;
    const marginfiAccount = {
      balances: [
        {
          active: true,
          bankPk: bankAddress,
          assetShares: new BigNumber(10e9),
          liabilityShares: new BigNumber(0),
          premiumRate: new BigNumber(0),
          premiumOutstanding: new BigNumber(0),
          lastUpdate: 0,
        },
      ],
      healthCache: {
        assetValueMaint: new BigNumber(collateralValue),
        liabilityValueMaint: new BigNumber(600),
        simulationStatus: HealthCacheStatus.COMPUTED,
      },
    } as unknown as MarginfiAccountType;

    const liquidationPrice = computeLiquidationPriceForBank({
      bank,
      oraclePrice,
      marginfiAccount,
      assetShareValueMultiplier: multiplier,
    });

    // 12 * 0.9 * (P - 2) = 600
    expect(liquidationPrice).toBeCloseTo(600 / (12 * 0.9) + 2, 6);
  });
});
