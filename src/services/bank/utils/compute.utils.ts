import BigNumber from "bignumber.js";
import { PublicKey } from "@solana/web3.js";

import { OraclePrice, PriceBias, getPrice } from "~/services/price";
import { MarginRequirementType } from "~/services/account/types";
import {
  PDA_BANK_LIQUIDITY_VAULT_SEED,
  PDA_BANK_INSURANCE_VAULT_SEED,
  PDA_BANK_FEE_VAULT_SEED,
  PDA_BANK_LIQUIDITY_VAULT_AUTH_SEED,
  PDA_BANK_INSURANCE_VAULT_AUTH_SEED,
  PDA_BANK_FEE_VAULT_AUTH_SEED,
  toBigNumber,
} from "~/utils";
import { Amount } from "~/types";

import { BankType, BankConfigType, BankVaultType } from "../types";

export function computeMaxLeverage(
  depositBank: BankType,
  borrowBank: BankType,
  opts?: { assetWeightInit?: BigNumber; liabilityWeightInit?: BigNumber }
): { maxLeverage: number; ltv: number } {
  const assetWeightInit = opts?.assetWeightInit || depositBank.config.assetWeightInit;
  const liabilityWeightInit = opts?.liabilityWeightInit || borrowBank.config.liabilityWeightInit;

  const ltv = assetWeightInit.div(liabilityWeightInit).toNumber();
  const maxLeverage = 1 / (1 - ltv);

  return {
    maxLeverage,
    ltv,
  };
}

export function computeLoopingParams(
  principal: Amount,
  targetLeverage: number,
  depositBank: BankType,
  borrowBank: BankType,
  depositOracleInfo: OraclePrice,
  borrowOracleInfo: OraclePrice,
  opts?: { assetWeightInit?: BigNumber; liabilityWeightInit?: BigNumber }
): { totalBorrowAmount: BigNumber; totalDepositAmount: BigNumber } {
  const initialCollateral = toBigNumber(principal);
  const { maxLeverage } = computeMaxLeverage(depositBank, borrowBank, opts);

  // Clamp target leverage to valid range instead of throwing
  let clampedLeverage = targetLeverage;

  if (targetLeverage < 1) {
    console.warn(`computeLoopingParams: targetLeverage ${targetLeverage} < 1, clamping to 1`);
    clampedLeverage = 1;
  } else if (targetLeverage > maxLeverage) {
    console.warn(
      `computeLoopingParams: targetLeverage ${targetLeverage} > maxLeverage ${maxLeverage}, clamping to ${maxLeverage}`
    );
    clampedLeverage = maxLeverage;
  }

  const totalDepositAmount = initialCollateral.times(new BigNumber(clampedLeverage));
  const additionalDepositAmount = totalDepositAmount.minus(initialCollateral);
  const totalBorrowAmount = additionalDepositAmount
    .times(depositOracleInfo.priceWeighted.lowestPrice)
    .div(borrowOracleInfo.priceWeighted.highestPrice);

  return {
    totalBorrowAmount: totalBorrowAmount.decimalPlaces(
      borrowBank.mintDecimals,
      BigNumber.ROUND_DOWN
    ),
    totalDepositAmount: totalDepositAmount.decimalPlaces(
      depositBank.mintDecimals,
      BigNumber.ROUND_DOWN
    ),
  };
}

/** Small getters */

export function getTotalAssetQuantity(bank: BankType): BigNumber {
  return bank.totalAssetShares.times(bank.assetShareValue);
}

export function getTotalLiabilityQuantity(bank: BankType): BigNumber {
  return bank.totalLiabilityShares.times(bank.liabilityShareValue);
}

export function getAssetQuantity(bank: BankType, assetShares: BigNumber): BigNumber {
  return assetShares.times(bank.assetShareValue);
}

export function getLiabilityQuantity(bank: BankType, liabilityShares: BigNumber): BigNumber {
  return liabilityShares.times(bank.liabilityShareValue);
}

export function getAssetShares(bank: BankType, assetQuantity: BigNumber): BigNumber {
  if (bank.assetShareValue.isZero()) {
    return new BigNumber(0);
  }
  return assetQuantity.div(bank.assetShareValue);
}

export function getLiabilityShares(bank: BankType, liabilityQuantity: BigNumber): BigNumber {
  if (bank.liabilityShareValue.isZero()) {
    return new BigNumber(0);
  }
  return liabilityQuantity.div(bank.liabilityShareValue);
}

export function getAssetWeight(
  bank: BankType,
  marginRequirementType: MarginRequirementType,
  oraclePrice: OraclePrice,
  opts?: {
    ignoreSoftLimits?: boolean;
    overrideWeights?: {
      assetWeightInit: BigNumber;
      assetWeightMaint: BigNumber;
    };
  }
): BigNumber {
  const assetWeightInit = opts?.overrideWeights?.assetWeightInit ?? bank.config.assetWeightInit;
  const assetWeightMaint = opts?.overrideWeights?.assetWeightMaint ?? bank.config.assetWeightMaint;

  switch (marginRequirementType) {
    case MarginRequirementType.Initial:
      const isSoftLimitDisabled = bank.config.totalAssetValueInitLimit.isZero();
      if (opts?.ignoreSoftLimits || isSoftLimitDisabled) return assetWeightInit;
      const totalBankCollateralValue = computeAssetUsdValue(
        bank,
        oraclePrice,
        bank.totalAssetShares,
        MarginRequirementType.Equity,
        PriceBias.Lowest,
        opts?.overrideWeights
      );
      if (totalBankCollateralValue.isGreaterThan(bank.config.totalAssetValueInitLimit)) {
        return bank.config.totalAssetValueInitLimit
          .div(totalBankCollateralValue)
          .times(assetWeightInit);
      } else {
        return assetWeightInit;
      }
    case MarginRequirementType.Maintenance:
      return assetWeightMaint;
    case MarginRequirementType.Equity:
      return new BigNumber(1);
    default:
      throw new Error("Invalid margin requirement type");
  }
}

export function getLiabilityWeight(
  config: BankConfigType,
  marginRequirementType: MarginRequirementType
): BigNumber {
  switch (marginRequirementType) {
    case MarginRequirementType.Initial:
      return config.liabilityWeightInit;
    case MarginRequirementType.Maintenance:
      return config.liabilityWeightMaint;
    case MarginRequirementType.Equity:
      return new BigNumber(1);
    default:
      throw new Error("Invalid margin requirement type");
  }
}

/** Computes  */

export function computeLiabilityUsdValue(
  bank: BankType,
  oraclePrice: OraclePrice,
  liabilityShares: BigNumber,
  marginRequirementType: MarginRequirementType,
  priceBias: PriceBias
): BigNumber {
  const liabilityQuantity = getLiabilityQuantity(bank, liabilityShares);
  const liabilityWeight = getLiabilityWeight(bank.config, marginRequirementType);
  const isWeighted = isWeightedPrice(marginRequirementType);
  return computeUsdValue(
    bank,
    oraclePrice,
    liabilityQuantity,
    priceBias,
    isWeighted,
    liabilityWeight
  );
}

export function computeAssetUsdValue(
  bank: BankType,
  oraclePrice: OraclePrice,
  assetShares: BigNumber,
  marginRequirementType: MarginRequirementType,
  priceBias: PriceBias,
  overrideWeights?: {
    assetWeightMaint: BigNumber;
    assetWeightInit: BigNumber;
  }
): BigNumber {
  const assetQuantity = getAssetQuantity(bank, assetShares);
  const assetWeight = getAssetWeight(bank, marginRequirementType, oraclePrice, {
    overrideWeights,
  });
  const isWeighted = isWeightedPrice(marginRequirementType);
  return computeUsdValue(bank, oraclePrice, assetQuantity, priceBias, isWeighted, assetWeight);
}

export function computeUsdValue(
  bank: BankType,
  oraclePrice: OraclePrice,
  quantity: BigNumber,
  priceBias: PriceBias,
  weightedPrice: boolean,
  weight?: BigNumber,
  scaleToBase: boolean = true
): BigNumber {
  const price = getPrice(oraclePrice, priceBias, weightedPrice);
  return quantity
    .times(price)
    .times(weight ?? 1)
    .dividedBy(scaleToBase ? 10 ** bank.mintDecimals : 1);
}

export function computeTvl(bank: BankType, oraclePrice: OraclePrice): BigNumber {
  return computeAssetUsdValue(
    bank,
    oraclePrice,
    bank.totalAssetShares,
    MarginRequirementType.Equity,
    PriceBias.None
  ).minus(
    computeLiabilityUsdValue(
      bank,
      oraclePrice,
      bank.totalLiabilityShares,
      MarginRequirementType.Equity,
      PriceBias.None
    )
  );
}

export function getBankVaultSeeds(type: BankVaultType): Buffer {
  switch (type) {
    case BankVaultType.LiquidityVault:
      return PDA_BANK_LIQUIDITY_VAULT_SEED;
    case BankVaultType.InsuranceVault:
      return PDA_BANK_INSURANCE_VAULT_SEED;
    case BankVaultType.FeeVault:
      return PDA_BANK_FEE_VAULT_SEED;
    default:
      throw Error(`Unknown vault type ${type}`);
  }
}

function getBankVaultAuthoritySeeds(type: BankVaultType): Buffer {
  switch (type) {
    case BankVaultType.LiquidityVault:
      return PDA_BANK_LIQUIDITY_VAULT_AUTH_SEED;
    case BankVaultType.InsuranceVault:
      return PDA_BANK_INSURANCE_VAULT_AUTH_SEED;
    case BankVaultType.FeeVault:
      return PDA_BANK_FEE_VAULT_AUTH_SEED;
    default:
      throw Error(`Unknown vault type ${type}`);
  }
}

/**
 * Compute authority PDA for a specific marginfi group bank vault
 */
export function getBankVaultAuthority(
  bankVaultType: BankVaultType,
  bankPk: PublicKey,
  programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [getBankVaultAuthoritySeeds(bankVaultType), bankPk.toBuffer()],
    programId
  );
}

export function isWeightedPrice(reqType: MarginRequirementType): boolean {
  return reqType === MarginRequirementType.Initial;
}
