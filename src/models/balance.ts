import type { Address } from "@solana/kit";
import { BigNumber } from "bignumber.js";

import {
  BalanceType,
  createEmptyBalance,
  OraclePrice,
  MarginRequirementType,
  computeBalanceUsdValue,
  getBalanceUsdValueWithPriceBias,
  computeQuantity,
  computeQuantityUi,
  computeTotalOutstandingEmissions,
  computeClaimedEmissions,
} from "../services";

import { Bank } from "./bank";

// ----------------------------------------------------------------------------
// Client types
// ----------------------------------------------------------------------------

class Balance implements BalanceType {
  constructor(
    public active: boolean,
    public bankPk: Address,
    public assetShares: BigNumber,
    public liabilityShares: BigNumber,
    public emissionsOutstanding: BigNumber,
    public lastUpdate: number
  ) {}

  static fromBalanceType(balance: BalanceType): Balance {
    return new Balance(
      balance.active,
      balance.bankPk,
      balance.assetShares,
      balance.liabilityShares,
      balance.emissionsOutstanding,
      balance.lastUpdate
    );
  }

  static createEmpty(bankPk: Address): Balance {
    const balance = createEmptyBalance(bankPk);
    return this.fromBalanceType(balance);
  }

  computeUsdValue(
    bank: Bank,
    oraclePrice: OraclePrice,
    marginRequirement = MarginRequirementType.Equity,
    assetShareValueMultiplier?: BigNumber,
    activeEmodeWeights?: {
      assetWeightInit: BigNumber;
      assetWeightMaint: BigNumber;
    }
  ): {
    assets: BigNumber;
    liabilities: BigNumber;
  } {
    return computeBalanceUsdValue({
      balance: this,
      bank,
      oraclePrice,
      marginRequirement,
      assetShareValueMultiplier,
      activeEmodeWeights,
    });
  }

  getUsdValueWithPriceBias(
    bank: Bank,
    oraclePrice: OraclePrice,
    marginRequirement = MarginRequirementType.Equity,
    assetShareValueMultiplier?: BigNumber,
    activeEmodeWeights?: {
      assetWeightInit: BigNumber;
      assetWeightMaint: BigNumber;
    }
  ): {
    assets: BigNumber;
    liabilities: BigNumber;
  } {
    return getBalanceUsdValueWithPriceBias({
      balance: this,
      bank,
      oraclePrice,
      marginRequirement,
      assetShareValueMultiplier,
      activeEmodeWeights,
    });
  }

  computeQuantity(bank: Bank): {
    assets: BigNumber;
    liabilities: BigNumber;
  } {
    return computeQuantity(this, bank);
  }

  computeQuantityUi(
    bank: Bank,
    assetShareValueMultiplier?: BigNumber
  ): {
    assets: BigNumber;
    liabilities: BigNumber;
  } {
    return computeQuantityUi(this, bank, assetShareValueMultiplier);
  }

  computeTotalOutstandingEmissions(bank: Bank): BigNumber {
    return computeTotalOutstandingEmissions(this, bank);
  }

  computeClaimedEmissions(bank: Bank, currentTimestamp: number): BigNumber {
    return computeClaimedEmissions(this, bank, currentTimestamp);
  }
}

export { Balance };
