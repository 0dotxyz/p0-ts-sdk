import { PublicKey } from "@solana/web3.js";
import BigNumber from "bignumber.js";

import { BankType, getAssetWeight, getLiabilityWeight } from "~/services/bank";
import { getPrice, OraclePrice, PriceBias } from "~/services/price";

import { MarginfiAccountType, MarginRequirementType } from "../../types";
import {
  computeBalanceUsdValue,
  computeHealthComponents,
  computeQuantityUi,
  getBalance,
} from "../compute.utils";

/**
 * Calculate the price at which the user position for the given bank will lead to liquidation, all other prices constant.
 */
function computeLiquidationPriceForBank(
  marginfiAccount: MarginfiAccountType,
  banks: Map<string, BankType>,
  oraclePrices: Map<string, OraclePrice>,
  bankAddress: PublicKey
): number | null {
  const bank = banks.get(bankAddress.toBase58());
  if (!bank) throw Error(`Bank ${bankAddress.toBase58()} not found`);
  const priceInfo = oraclePrices.get(bankAddress.toBase58());
  if (!priceInfo)
    throw Error(`Price info for ${bankAddress.toBase58()} not found`);

  const balance = getBalance(bankAddress, marginfiAccount.balances);

  if (!balance.active) return null;

  const { assets: assetBank, liabilities: liabilitiesBank } =
    computeBalanceUsdValue(
      balance,
      bank,
      priceInfo,
      MarginRequirementType.Maintenance
    );

  const { assets: assetsAccount, liabilities: liabilitiesAccount } =
    computeHealthComponents(marginfiAccount, MarginRequirementType.Maintenance);

  const assets = assetsAccount.minus(assetBank);
  const liabilities = liabilitiesAccount.minus(liabilitiesBank);

  const isLending = balance.liabilityShares.isZero();
  const { assets: assetQuantityUi, liabilities: liabQuantitiesUi } =
    computeQuantityUi(balance, bank);

  let liquidationPrice: BigNumber;
  if (isLending) {
    if (liabilities.eq(0)) return null;

    const assetWeight = getAssetWeight(
      bank,
      MarginRequirementType.Maintenance,
      priceInfo
    );
    const priceConfidence = getPrice(priceInfo, PriceBias.None, false).minus(
      getPrice(priceInfo, PriceBias.Lowest, false)
    );
    liquidationPrice = liabilities
      .minus(assets)
      .div(assetQuantityUi.times(assetWeight))
      .plus(priceConfidence);
  } else {
    const liabWeight = getLiabilityWeight(
      bank.config,
      MarginRequirementType.Maintenance
    );
    const priceConfidence = getPrice(priceInfo, PriceBias.Highest, false).minus(
      getPrice(priceInfo, PriceBias.None, false)
    );
    liquidationPrice = assets
      .minus(liabilities)
      .div(liabQuantitiesUi.times(liabWeight))
      .minus(priceConfidence);
  }
  if (
    liquidationPrice.isNaN() ||
    liquidationPrice.lt(0) ||
    !liquidationPrice.isFinite()
  )
    return null;
  return liquidationPrice.toNumber();
}

/**
 * Calculate the price at which the user position for the given bank will lead to liquidation, all other prices constant.
 */
function computeLiquidationPriceForBankHealth(
  marginfiAccount: MarginfiAccountType,
  banks: Map<string, BankType>,
  oraclePrices: Map<string, OraclePrice>,
  bankAddress: PublicKey
): number | null {
  const bank = banks.get(bankAddress.toBase58());
  if (!bank) throw Error(`Bank ${bankAddress.toBase58()} not found`);
  const priceInfo = oraclePrices.get(bankAddress.toBase58());
  if (!priceInfo)
    throw Error(`Price info for ${bankAddress.toBase58()} not found`);

  const balance = getBalance(bankAddress, marginfiAccount.balances);

  if (!balance.active) return null;

  const isLending = balance.liabilityShares.isZero();

  let assetValueMaint = marginfiAccount.healthCache.assetValueMaint;
  let liabValueMaint = marginfiAccount.healthCache.liabilityValueMaint;

  const { assets: assetQuantityUi, liabilities: liabQuantitiesUi } =
    computeQuantityUi(balance, bank);

  let liquidationPrice: BigNumber;
  if (isLending) {
    if (liabValueMaint.eq(0)) return null;

    const assetWeight = getAssetWeight(
      bank,
      MarginRequirementType.Maintenance,
      priceInfo,
      undefined
    );
    const priceConfidence = getPrice(priceInfo, PriceBias.None, false).minus(
      getPrice(priceInfo, PriceBias.Lowest, false)
    );
    liquidationPrice = liabValueMaint
      .minus(assetValueMaint)
      .div(assetQuantityUi.times(assetWeight))
      .plus(priceConfidence);
  } else {
    const liabWeight = getLiabilityWeight(
      bank.config,
      MarginRequirementType.Maintenance
    );
    const priceConfidence = getPrice(priceInfo, PriceBias.Highest, false).minus(
      getPrice(priceInfo, PriceBias.None, false)
    );
    liquidationPrice = assetValueMaint
      .minus(liabValueMaint)
      .div(liabQuantitiesUi.times(liabWeight))
      .minus(priceConfidence);
  }
  if (
    liquidationPrice.isNaN() ||
    liquidationPrice.lt(0) ||
    !liquidationPrice.isFinite()
  )
    return null;
  return liquidationPrice.toNumber();
}

/**
 * Calculate the price at which the user position for the given bank and amount will lead to liquidation, all other prices constant.
 */
function computeLiquidationPriceForBankAmount(
  marginfiAccount: MarginfiAccountType,
  banks: Map<string, BankType>,
  oraclePrices: Map<string, OraclePrice>,
  bankAddress: PublicKey,
  isLending: boolean,
  amount: number
): number | null {
  const bank = banks.get(bankAddress.toBase58());
  if (!bank) throw Error(`Bank ${bankAddress.toBase58()} not found`);
  const priceInfo = oraclePrices.get(bankAddress.toBase58());
  if (!priceInfo)
    throw Error(`Price info for ${bankAddress.toBase58()} not found`);

  const balance = getBalance(bankAddress, marginfiAccount.balances);

  if (!balance.active) return null;

  const { assets: assetBank, liabilities: liabilitiesBank } =
    computeBalanceUsdValue(
      balance,
      bank,
      priceInfo,
      MarginRequirementType.Maintenance
    );

  const { assets: assetsAccount, liabilities: liabilitiesAccount } =
    computeHealthComponents(marginfiAccount, MarginRequirementType.Maintenance);

  const assets = assetsAccount.minus(assetBank);
  const liabilities = liabilitiesAccount.minus(liabilitiesBank);

  const amountBn = new BigNumber(amount);

  let liquidationPrice: BigNumber;
  if (isLending) {
    if (liabilities.eq(0)) return null;

    const assetWeight = getAssetWeight(
      bank,
      MarginRequirementType.Maintenance,
      priceInfo
    );
    const priceConfidence = getPrice(priceInfo, PriceBias.None, false).minus(
      getPrice(priceInfo, PriceBias.Lowest, false)
    );
    liquidationPrice = liabilities
      .minus(assets)
      .div(amountBn.times(assetWeight))
      .plus(priceConfidence);
  } else {
    const liabWeight = getLiabilityWeight(
      bank.config,
      MarginRequirementType.Maintenance
    );
    const priceConfidence = getPrice(priceInfo, PriceBias.Highest, false).minus(
      getPrice(priceInfo, PriceBias.None, false)
    );
    liquidationPrice = assets
      .minus(liabilities)
      .div(amountBn.times(liabWeight))
      .minus(priceConfidence);
  }
  if (liquidationPrice.isNaN() || liquidationPrice.lt(0)) return null;
  return liquidationPrice.toNumber();
}

// Calculate the max amount of collateral to liquidate to bring an account maint health to 0 (assuming negative health).
//
// The asset amount is bounded by 2 constraints,
// (1) the amount of liquidated collateral cannot be more than the balance,
// (2) the amount of covered liablity cannot be more than existing liablity.
function computeMaxLiquidatableAssetAmount(
  marginfiAccount: MarginfiAccountType,
  banks: Map<string, BankType>,
  oraclePrices: Map<string, OraclePrice>,
  assetBankAddress: PublicKey,
  liabilityBankAddress: PublicKey
): BigNumber {
  const assetBank = banks.get(assetBankAddress.toBase58());
  if (!assetBank) throw Error(`Bank ${assetBankAddress.toBase58()} not found`);
  const assetPriceInfo = oraclePrices.get(assetBankAddress.toBase58());
  if (!assetPriceInfo)
    throw Error(`Price info for ${assetBankAddress.toBase58()} not found`);

  const liabilityBank = banks.get(liabilityBankAddress.toBase58());
  if (!liabilityBank)
    throw Error(`Bank ${liabilityBankAddress.toBase58()} not found`);
  const liabilityPriceInfo = oraclePrices.get(liabilityBankAddress.toBase58());
  if (!liabilityPriceInfo)
    throw Error(`Price info for ${liabilityBankAddress.toBase58()} not found`);

  const { assets, liabilities } = computeHealthComponents(
    marginfiAccount,
    MarginRequirementType.Maintenance
  );
  const currentHealth = assets.minus(liabilities);

  const priceAssetLower = getPrice(assetPriceInfo, PriceBias.Lowest, false);
  const priceAssetMarket = getPrice(assetPriceInfo, PriceBias.None, false);
  const assetMaintWeight = assetBank.config.assetWeightMaint;

  const liquidationDiscount = new BigNumber(0.95);

  const priceLiabHighest = getPrice(
    liabilityPriceInfo,
    PriceBias.Highest,
    false
  );
  const priceLiabMarket = getPrice(liabilityPriceInfo, PriceBias.None, false);
  const liabMaintWeight = liabilityBank.config.liabilityWeightMaint;

  const underwaterMaintUsdValue = currentHealth.div(
    assetMaintWeight.minus(liabMaintWeight.times(liquidationDiscount))
  );

  // MAX asset amount bounded by available asset amount
  const assetBalance = getBalance(assetBankAddress, marginfiAccount.balances);
  const assetsAmountUi = computeQuantityUi(assetBalance, assetBank).assets;
  const assetsUsdValue = assetsAmountUi.times(priceAssetLower);

  // MAX asset amount bounded by available liability amount
  const liabilityBalance = getBalance(
    liabilityBankAddress,
    marginfiAccount.balances
  );
  const liabilitiesAmountUi = computeQuantityUi(
    liabilityBalance,
    liabilityBank
  ).liabilities;
  const liabUsdValue = liabilitiesAmountUi
    .times(liquidationDiscount)
    .times(priceLiabHighest);

  const maxLiquidatableUsdValue = BigNumber.min(
    assetsUsdValue,
    underwaterMaintUsdValue,
    liabUsdValue
  );

  return maxLiquidatableUsdValue.div(priceAssetLower);
}
