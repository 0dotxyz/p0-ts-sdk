import BigNumber from "bignumber.js";
import { PublicKey } from "@solana/web3.js";

import {
  ActiveEmodePair,
  BankType,
  computeAssetUsdValue,
  EmodeImpactStatus,
  getAssetWeight,
  getLiabilityWeight,
  RiskTier,
} from "~/services/bank";
import { getPrice, OraclePrice, PriceBias } from "~/services/price";

import { MarginfiAccountType, MarginRequirementType } from "../types";

import {
  computeFreeCollateral,
  computeFreeCollateralLegacy,
  computeHealthComponents,
  computeQuantityUi,
  getActiveBalances,
  getBalance,
} from "./compute.utils";

/**
 * Applies emode weights to all banks with matching emode tags.
 * Uses BigNumber.max to take the higher of existing or emode weight.
 */
function applyEmodeWeightsToBanks(
  banks: Map<string, BankType>,
  activePair: ActiveEmodePair
): Map<string, BankType> {
  const modifiedBanks = new Map(banks);

  banks.forEach((bank, key) => {
    if (bank.emode?.emodeTag && activePair.collateralBankTags.includes(bank.emode.emodeTag)) {
      modifiedBanks.set(key, {
        ...bank,
        config: {
          ...bank.config,
          assetWeightMaint: BigNumber.max(
            bank.config.assetWeightMaint,
            activePair.assetWeightMaint
          ),
          assetWeightInit: BigNumber.max(bank.config.assetWeightInit, activePair.assetWeightInit),
        },
      });
    }
  });

  return modifiedBanks;
}

export function computeMaxBorrowForBank(
  account: MarginfiAccountType,
  banks: Map<string, BankType>,
  oraclePrices: Map<string, OraclePrice>,
  bankAddress: PublicKey,
  opts?: {
    emodeImpactStatus?: EmodeImpactStatus;
    volatilityFactor?: number;
    activePair?: ActiveEmodePair;
  }
): BigNumber {
  // Apply emode weights to all banks with matching tags
  const effectiveBanks = opts?.activePair
    ? applyEmodeWeightsToBanks(banks, opts.activePair)
    : banks;

  const bank = effectiveBanks.get(bankAddress.toBase58());

  if (!bank) throw Error(`Bank ${bankAddress.toBase58()} not found`);

  const priceInfo = oraclePrices.get(bankAddress.toBase58());
  if (!priceInfo) throw Error(`Price info for ${bankAddress.toBase58()} not found`);

  const activeBalances = getActiveBalances(account.balances);

  // -------------------------- //
  // isolated asset constraints //
  // -------------------------- //

  const hasLiabilitiesAlready =
    activeBalances.filter((b) => b.liabilityShares.gt(0) && !b.bankPk.equals(bankAddress)).length >
    0;

  const attemptingToBorrowIsolatedAssetWithActiveDebt =
    bank.config.riskTier === RiskTier.Isolated && hasLiabilitiesAlready;

  const existingLiabilityBanks = activeBalances
    .filter((b) => b.liabilityShares.gt(0))
    .map((b) => effectiveBanks.get(b.bankPk.toBase58())!);

  const attemptingToBorrowNewAssetWithExistingIsolatedDebt = existingLiabilityBanks.some(
    (b) => b.config.riskTier === RiskTier.Isolated && !b.address.equals(bankAddress)
  );

  if (
    attemptingToBorrowIsolatedAssetWithActiveDebt ||
    attemptingToBorrowNewAssetWithExistingIsolatedDebt
  ) {
    // Cannot borrow due to isolated tier constraints
    return new BigNumber(0);
  }

  // ------------- //
  // FC-based calc //
  // ------------- //

  const _volatilityFactor = opts?.volatilityFactor ?? 1;

  const balance = getBalance(bankAddress, activeBalances);

  const useCache =
    opts?.emodeImpactStatus === EmodeImpactStatus.InactiveEmode ||
    opts?.emodeImpactStatus === EmodeImpactStatus.ExtendEmode;

  let freeCollateral = useCache
    ? computeFreeCollateral(account).times(_volatilityFactor)
    : computeFreeCollateralLegacy(activeBalances, effectiveBanks, oraclePrices).times(
        _volatilityFactor
      );

  const untiedCollateralForBank = BigNumber.min(
    computeAssetUsdValue(
      bank,
      priceInfo,
      balance.assetShares,
      MarginRequirementType.Initial,
      PriceBias.Lowest
    ),
    freeCollateral
  );

  const priceLowestBias = getPrice(priceInfo, PriceBias.Lowest, true);
  const priceHighestBias = getPrice(priceInfo, PriceBias.Highest, true);
  const assetWeight = getAssetWeight(bank, MarginRequirementType.Initial, priceInfo);
  const liabWeight = getLiabilityWeight(bank.config, MarginRequirementType.Initial);

  if (assetWeight.eq(0)) {
    return computeQuantityUi(balance, bank).assets.plus(
      freeCollateral.minus(untiedCollateralForBank).div(priceHighestBias.times(liabWeight))
    );
  } else {
    return untiedCollateralForBank
      .div(priceLowestBias.times(assetWeight))
      .plus(freeCollateral.minus(untiedCollateralForBank).div(priceHighestBias.times(liabWeight)));
  }
}

export function computeMaxWithdrawForBank(
  account: MarginfiAccountType,
  banks: Map<string, BankType>,
  oraclePrices: Map<string, OraclePrice>,
  bankAddress: PublicKey,
  opts?: {
    volatilityFactor?: number;
    activePair?: ActiveEmodePair;
  }
): BigNumber {
  // Apply emode weights to all banks with matching tags
  const effectiveBanks = opts?.activePair
    ? applyEmodeWeightsToBanks(banks, opts.activePair)
    : banks;

  const bank = effectiveBanks.get(bankAddress.toBase58());
  if (!bank) throw Error(`Bank ${bankAddress.toBase58()} not found`);
  const priceInfo = oraclePrices.get(bankAddress.toBase58());
  if (!priceInfo) throw Error(`Price info for ${bankAddress.toBase58()} not found`);

  const _volatilityFactor = opts?.volatilityFactor ?? 1;

  // Get weights - they'll use emode weights if bank was modified
  const initAssetWeight = getAssetWeight(bank, MarginRequirementType.Initial, priceInfo, {
    ignoreSoftLimits: false,
  });
  const maintAssetWeight = getAssetWeight(bank, MarginRequirementType.Maintenance, priceInfo, {
    ignoreSoftLimits: false,
  });
  const activeBalances = getActiveBalances(account.balances);
  const balance = getBalance(bankAddress, activeBalances);

  // Recalculate free collateral if emode weights were applied
  const freeCollateral = opts?.activePair
    ? computeFreeCollateralLegacy(activeBalances, effectiveBanks, oraclePrices)
    : computeFreeCollateral(account);

  const initCollateralForBank = computeAssetUsdValue(
    bank,
    priceInfo,
    balance.assetShares,
    MarginRequirementType.Initial,
    PriceBias.Lowest
  );

  const entireBalance = computeQuantityUi(balance, bank).assets;

  const { liabilities: liabilitiesInit } = computeHealthComponents(
    account,
    MarginRequirementType.Initial
  );

  // -------------------------------------------------- //
  // isolated bank (=> init weight = maint weight = 0)  //
  // or collateral bank with 0-weights (does not happen //
  // in practice)                                       //
  // -------------------------------------------------- //

  if (
    bank.config.riskTier === RiskTier.Isolated ||
    (initAssetWeight.isZero() && maintAssetWeight.isZero())
  ) {
    if (freeCollateral.isZero() && !liabilitiesInit.isZero()) {
      // if account is already below init requirements and has active debt, prevent any withdrawal even if those don't count as collateral
      // inefficient, but reflective of contract which does not look at action delta, but only end state atm
      return new BigNumber(0);
    } else {
      return entireBalance;
    }
  }

  // ----------------------------- //
  // collateral bank being retired //
  // ----------------------------- //

  if (initAssetWeight.isZero() && !maintAssetWeight.isZero()) {
    if (liabilitiesInit.eq(0)) {
      return entireBalance;
    } else if (freeCollateral.isZero()) {
      return new BigNumber(0); // inefficient, but reflective of contract which does not look at action delta, but only end state
    } else {
      const { liabilities: maintLiabilities, assets: maintAssets } = computeHealthComponents(
        account,
        MarginRequirementType.Maintenance
      );
      const maintUntiedCollateral = maintAssets.minus(maintLiabilities);

      const priceLowestBias = getPrice(priceInfo, PriceBias.Lowest, true);
      const maintWeightedPrice = priceLowestBias.times(maintAssetWeight);

      return maintUntiedCollateral.div(maintWeightedPrice);
    }
  }

  // ------------------------------------- //
  // collateral bank with positive weights //
  // ------------------------------------- //
  // bypass volatility factor if no liabilities or if all collateral is untied
  if (liabilitiesInit.isZero() || initCollateralForBank.lte(freeCollateral)) {
    return entireBalance;
  }

  // apply volatility factor to avoid failure due to price volatility / slippage
  const initUntiedCollateralForBank = freeCollateral.times(_volatilityFactor);

  const priceLowestBias = getPrice(priceInfo, PriceBias.Lowest, true);
  const initWeightedPrice = priceLowestBias.times(initAssetWeight);
  const maxWithdraw = initUntiedCollateralForBank.div(initWeightedPrice);

  return maxWithdraw;
}
