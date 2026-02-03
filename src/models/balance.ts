import { PublicKey } from "@solana/web3.js";
import BigNumber from "bignumber.js";

import { Bank } from "./bank";
import {
  BalanceType,
  BalanceRaw,
  parseBalanceRaw,
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

// ----------------------------------------------------------------------------
// Client types
// ----------------------------------------------------------------------------

class Balance implements BalanceType {
  constructor(
    public active: boolean,
    public bankPk: PublicKey,
    public assetShares: BigNumber,
    public liabilityShares: BigNumber,
    public emissionsOutstanding: BigNumber,
    public lastUpdate: number
  ) {}

  static from(balanceRaw: BalanceRaw): Balance {
    const props = parseBalanceRaw(balanceRaw);
    return new Balance(
      props.active,
      props.bankPk,
      props.assetShares,
      props.liabilityShares,
      props.emissionsOutstanding,
      props.lastUpdate
    );
  }

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

  static createEmpty(bankPk: PublicKey): Balance {
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
