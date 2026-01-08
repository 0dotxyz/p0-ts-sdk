import BigNumber from "bignumber.js";
import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import { BorshInstructionCoder } from "@coral-xyz/anchor";

import {
  aprToApy,
  composeRemainingAccounts,
  nativeToUi,
  shortenAddress,
} from "@mrgnlabs/mrgn-common";

import {
  BankType,
  computeInterestRates,
  computeAssetUsdValue,
  computeLiabilityUsdValue,
  getAssetQuantity,
  getLiabilityQuantity,
  getAssetShares,
  getLiabilityShares,
  getAssetWeight,
  getLiabilityWeight,
} from "~/services/bank";
import { getPrice, OraclePrice, PriceBias } from "~/services/price";
import { MarginfiProgram } from "~/types";

import {
  MarginfiAccountType,
  BalanceType,
  MarginRequirementType,
  HealthCacheType,
  HealthCacheStatus,
} from "../types";

/**
 * Marginfi Account Computes
 * =========================
 */

export function computeFreeCollateral(
  marginfiAccount: MarginfiAccountType,
  opts?: { clamped?: boolean }
): BigNumber {
  const _clamped = opts?.clamped ?? true;

  const { assets, liabilities } = computeHealthComponents(
    marginfiAccount,
    MarginRequirementType.Initial
  );

  const signedFreeCollateral = assets.minus(liabilities);

  return _clamped
    ? BigNumber.max(0, signedFreeCollateral)
    : signedFreeCollateral;
}

export function computeFreeCollateralLegacy(
  activeBalances: BalanceType[],
  banks: Map<string, BankType>,
  oraclePrices: Map<string, OraclePrice>,
  opts?: { clamped?: boolean }
): BigNumber {
  const _clamped = opts?.clamped ?? true;

  const { assets, liabilities } = computeHealthComponentsLegacy(
    activeBalances,
    banks,
    oraclePrices,
    MarginRequirementType.Initial,
    []
  );

  const signedFreeCollateral = assets.minus(liabilities);

  return _clamped
    ? BigNumber.max(0, signedFreeCollateral)
    : signedFreeCollateral;
}

export function computeHealthComponents(
  marginfiAccount: MarginfiAccountType,
  marginReqType: MarginRequirementType
): {
  assets: BigNumber;
  liabilities: BigNumber;
} {
  // check if health cache failed
  switch (marginReqType) {
    case MarginRequirementType.Equity:
      return {
        assets: marginfiAccount.healthCache.assetValueEquity,
        liabilities: marginfiAccount.healthCache.liabilityValueEquity,
      };
    case MarginRequirementType.Initial:
      return {
        assets: marginfiAccount.healthCache.assetValue,
        liabilities: marginfiAccount.healthCache.liabilityValue,
      };
    case MarginRequirementType.Maintenance:
      return {
        assets: marginfiAccount.healthCache.assetValueMaint,
        liabilities: marginfiAccount.healthCache.liabilityValueMaint,
      };
  }
}

export function computeHealthComponentsLegacy(
  activeBalances: BalanceType[],
  banks: Map<string, BankType>,
  oraclePrices: Map<string, OraclePrice>,
  marginReqType: MarginRequirementType,
  excludedBanks: PublicKey[] = [],
  activeEmodeWeights?: Record<
    string,
    {
      assetWeightMaint: BigNumber;
      assetWeightInit: BigNumber;
    }
  >
): {
  assets: BigNumber;
  liabilities: BigNumber;
} {
  const filteredBalances = activeBalances.filter(
    (accountBalance) =>
      !excludedBanks.find((b) => b.equals(accountBalance.bankPk))
  );

  const updatedOraclePrices = new Map(oraclePrices);

  const [assets, liabilities] = filteredBalances
    .map((accountBalance) => {
      const bank = banks.get(accountBalance.bankPk.toBase58());
      if (!bank) {
        console.warn(
          `Bank ${shortenAddress(accountBalance.bankPk)} not found, excluding from health computation`
        );
        return [new BigNumber(0), new BigNumber(0)];
      }

      const priceInfo = updatedOraclePrices.get(
        accountBalance.bankPk.toBase58()
      );
      if (!priceInfo) {
        console.warn(
          `Price info for bank ${shortenAddress(accountBalance.bankPk)} not found, excluding from health computation`
        );
        return [new BigNumber(0), new BigNumber(0)];
      }

      const emodeWeight =
        activeEmodeWeights?.[accountBalance.bankPk.toBase58()];

      // if emode weight is lower than bank config, use bank config
      const overrideWeights = emodeWeight
        ? {
            assetWeightInit: emodeWeight.assetWeightInit
              ? BigNumber.max(
                  bank.config.assetWeightInit,
                  emodeWeight.assetWeightInit
                )
              : bank.config.assetWeightInit,
            assetWeightMaint: emodeWeight.assetWeightMaint
              ? BigNumber.max(
                  bank.config.assetWeightMaint,
                  emodeWeight.assetWeightMaint
                )
              : bank.config.assetWeightMaint,
          }
        : undefined;

      const { assets, liabilities } = getBalanceUsdValueWithPriceBias(
        accountBalance,
        bank,
        priceInfo,
        marginReqType,
        overrideWeights
      );
      return [assets, liabilities];
    })
    .reduce(
      // TODO: figure out type assertion & remove
      ([asset, liability], [d, l]) => {
        return [asset!.plus(d!), liability!.plus(l!)];
      },
      [new BigNumber(0), new BigNumber(0)]
    );

  return { assets: assets!, liabilities: liabilities! };
}

export function computeHealthComponentsWithoutBiasLegacy(
  activeBalances: BalanceType[],
  banks: Map<string, BankType>,
  oraclePrices: Map<string, OraclePrice>,
  marginReqType: MarginRequirementType,
  activeEmodeWeights?: Record<
    string,
    {
      assetWeightMaint: BigNumber;
      assetWeightInit: BigNumber;
    }
  >
): {
  assets: BigNumber;
  liabilities: BigNumber;
} {
  const updatedOraclePrices = new Map(oraclePrices);

  const [assets, liabilities] = activeBalances
    .map((accountBalance) => {
      const bank = banks.get(accountBalance.bankPk.toBase58());
      if (!bank) {
        console.warn(
          `Bank ${shortenAddress(accountBalance.bankPk)} not found, excluding from health computation`
        );
        return [new BigNumber(0), new BigNumber(0)];
      }

      const priceInfo = updatedOraclePrices.get(
        accountBalance.bankPk.toBase58()
      );
      if (!priceInfo) {
        console.warn(
          `Price info for bank ${shortenAddress(accountBalance.bankPk)} not found, excluding from health computation`
        );
        return [new BigNumber(0), new BigNumber(0)];
      }

      const emodeWeight =
        activeEmodeWeights?.[accountBalance.bankPk.toBase58()];

      // if emode weight is lower than bank config, use bank config
      const overrideWeights = emodeWeight
        ? {
            assetWeightInit: emodeWeight.assetWeightInit
              ? BigNumber.max(
                  bank.config.assetWeightInit,
                  emodeWeight.assetWeightInit
                )
              : bank.config.assetWeightInit,
            assetWeightMaint: emodeWeight.assetWeightMaint
              ? BigNumber.max(
                  bank.config.assetWeightMaint,
                  emodeWeight.assetWeightMaint
                )
              : bank.config.assetWeightMaint,
          }
        : undefined;

      const { assets, liabilities } = computeBalanceUsdValue(
        accountBalance,
        bank,
        priceInfo,
        marginReqType,
        overrideWeights
      );
      return [assets, liabilities];
    })
    .reduce(
      // TODO: figure out type assertion & remove
      ([asset, liability], [d, l]) => {
        return [asset!.plus(d!), liability!.plus(l!)];
      },
      [new BigNumber(0), new BigNumber(0)]
    );

  return { assets: assets!, liabilities: liabilities! };
}

export function computeAccountValue(
  marginfiAccount: MarginfiAccountType
): BigNumber {
  const { assets, liabilities } = computeHealthComponents(
    marginfiAccount,
    MarginRequirementType.Equity
  );
  return assets.minus(liabilities);
}

export function computeNetApy(
  marginfiAccount: MarginfiAccountType,
  activeBalances: BalanceType[],
  banks: Map<string, BankType>,
  oraclePrices: Map<string, OraclePrice>
): number {
  const { assets, liabilities } = computeHealthComponents(
    marginfiAccount,
    MarginRequirementType.Equity
  );
  const totalUsdValue = assets.minus(liabilities);
  const apr = activeBalances
    .reduce((weightedApr, balance) => {
      const bank = banks.get(balance.bankPk.toBase58());
      if (!bank) {
        console.warn(
          `Bank ${shortenAddress(balance.bankPk)} not found, excluding from APY computation`
        );
        return weightedApr;
      }

      const priceInfo = oraclePrices.get(balance.bankPk.toBase58());
      if (!priceInfo) {
        console.warn(
          `Price info for bank ${shortenAddress(balance.bankPk)} not found, excluding from APY computation`
        );
        return weightedApr;
      }

      return weightedApr
        .minus(
          computeInterestRates(bank)
            .borrowingRate.times(
              computeBalanceUsdValue(
                balance,
                bank,
                priceInfo,
                MarginRequirementType.Equity
              ).liabilities
            )
            .div(totalUsdValue.isEqualTo(0) ? 1 : totalUsdValue)
        )
        .plus(
          computeInterestRates(bank)
            .lendingRate.times(
              computeBalanceUsdValue(
                balance,
                bank,
                priceInfo,
                MarginRequirementType.Equity
              ).assets
            )
            .div(totalUsdValue.isEqualTo(0) ? 1 : totalUsdValue)
        );
    }, new BigNumber(0))
    .toNumber();

  return aprToApy(apr);
}

/**
 * Marginfi Balance Computes
 * =========================
 */

export function computeBalanceUsdValue(
  balance: BalanceType,
  bank: BankType,
  oraclePrice: OraclePrice,
  marginRequirementType: MarginRequirementType,
  overrideWeights?: {
    assetWeightMaint: BigNumber;
    assetWeightInit: BigNumber;
  }
): {
  assets: BigNumber;
  liabilities: BigNumber;
} {
  const assetsValue = computeAssetUsdValue(
    bank,
    oraclePrice,
    balance.assetShares,
    marginRequirementType,
    PriceBias.None,
    overrideWeights
  );
  const liabilitiesValue = computeLiabilityUsdValue(
    bank,
    oraclePrice,
    balance.liabilityShares,
    marginRequirementType,
    PriceBias.None
  );
  return { assets: assetsValue, liabilities: liabilitiesValue };
}

export function getBalanceUsdValueWithPriceBias(
  balance: BalanceType,
  bank: BankType,
  oraclePrice: OraclePrice,
  marginRequirementType: MarginRequirementType,
  overrideWeights?: {
    assetWeightMaint: BigNumber;
    assetWeightInit: BigNumber;
  }
): {
  assets: BigNumber;
  liabilities: BigNumber;
} {
  const assetsValue = computeAssetUsdValue(
    bank,
    oraclePrice,
    balance.assetShares,
    marginRequirementType,
    PriceBias.Lowest,
    overrideWeights
  );
  const liabilitiesValue = computeLiabilityUsdValue(
    bank,
    oraclePrice,
    balance.liabilityShares,
    marginRequirementType,
    PriceBias.Highest
  );
  return { assets: assetsValue, liabilities: liabilitiesValue };
}

export function computeQuantity(
  balance: BalanceType,
  bank: BankType
): {
  assets: BigNumber;
  liabilities: BigNumber;
} {
  const assetsQuantity = getAssetQuantity(bank, balance.assetShares);
  const liabilitiesQuantity = getLiabilityQuantity(
    bank,
    balance.liabilityShares
  );
  return { assets: assetsQuantity, liabilities: liabilitiesQuantity };
}

export function computeQuantityUi(
  balance: BalanceType,
  bank: BankType
): {
  assets: BigNumber;
  liabilities: BigNumber;
} {
  const assetsQuantity = new BigNumber(
    nativeToUi(getAssetQuantity(bank, balance.assetShares), bank.mintDecimals)
  );
  const liabilitiesQuantity = new BigNumber(
    nativeToUi(
      getLiabilityQuantity(bank, balance.liabilityShares),
      bank.mintDecimals
    )
  );
  return { assets: assetsQuantity, liabilities: liabilitiesQuantity };
}

export function computeClaimedEmissions(
  balance: BalanceType,
  bank: BankType,
  currentTimestamp: number
): BigNumber {
  const lendingActive = bank.emissionsActiveLending;
  const borrowActive = bank.emissionsActiveBorrowing;

  const { assets, liabilities } = computeQuantity(balance, bank);

  let balanceAmount: BigNumber | null = null;

  if (lendingActive) {
    balanceAmount = assets;
  } else if (borrowActive) {
    balanceAmount = liabilities;
  }

  if (balanceAmount) {
    const lastUpdate = balance.lastUpdate;
    const period = new BigNumber(currentTimestamp - lastUpdate);
    const emissionsRate = new BigNumber(bank.emissionsRate);
    const emissions = period
      .times(balanceAmount)
      .times(emissionsRate)
      .div(31_536_000 * Math.pow(10, bank.mintDecimals));
    const emissionsReal = BigNumber.min(
      emissions,
      new BigNumber(bank.emissionsRemaining)
    );

    return emissionsReal;
  }

  return new BigNumber(0);
}

export function computeTotalOutstandingEmissions(
  balance: BalanceType,
  bank: BankType
): BigNumber {
  const claimedEmissions = balance.emissionsOutstanding;
  const unclaimedEmissions = computeClaimedEmissions(
    balance,
    bank,
    Date.now() / 1000
  );
  return claimedEmissions.plus(unclaimedEmissions);
}

export function computeHealthCheckAccounts(
  balances: BalanceType[],
  banks: Map<string, BankType>,
  mandatoryBanks: PublicKey[] = [],
  excludedBanks: PublicKey[] = []
): BankType[] {
  const activeBalances = balances.filter((b) => b.active);

  const mandatoryBanksSet = new Set(mandatoryBanks.map((b) => b.toBase58()));
  const excludedBanksSet = new Set(excludedBanks.map((b) => b.toBase58()));
  const activeBanks = new Set(activeBalances.map((b) => b.bankPk.toBase58()));
  const banksToAdd = new Set(
    [...mandatoryBanksSet].filter((x) => !activeBanks.has(x))
  );

  let slotsToKeep = banksToAdd.size;
  const projectedActiveBanks = balances
    .filter((balance) => {
      if (balance.active) {
        return !excludedBanksSet.has(balance.bankPk.toBase58());
      } else if (slotsToKeep > 0) {
        slotsToKeep--;
        return true;
      } else {
        return false;
      }
    })
    .map((balance) => {
      if (balance.active) {
        const bank = banks.get(balance.bankPk.toBase58());
        if (!bank) throw Error(`Bank ${balance.bankPk.toBase58()} not found`);
        return bank;
      }
      const newBankAddress = [...banksToAdd.values()][0]!;
      banksToAdd.delete(newBankAddress);
      const bank = banks.get(newBankAddress);
      if (!bank) throw Error(`Bank ${newBankAddress} not found`);
      return bank;
    });

  return projectedActiveBanks;
}

export function computeHealthAccountMetas(
  banksToInclude: BankType[],
  enableSorting = true
): PublicKey[] {
  let wrapperFn = enableSorting
    ? composeRemainingAccounts
    : (banksAndOracles: PublicKey[][]) => banksAndOracles.flat();

  const accounts = wrapperFn(
    banksToInclude.map((bank) => {
      let keys = [];
      if (bank.oracleKey.equals(PublicKey.default)) {
        keys = [bank.address];
      } else {
        keys = [bank.address, bank.oracleKey];
      }

      // for kamino banks, include kamino reserve
      if (bank.config.assetTag === 3) {
        keys.push(bank.kaminoReserve);
      }

      return keys;
    })
  );

  return accounts;
}

export function createEmptyBalance(bankPk: PublicKey): BalanceType {
  const balance: BalanceType = {
    active: false,
    bankPk,
    assetShares: new BigNumber(0),
    liabilityShares: new BigNumber(0),
    emissionsOutstanding: new BigNumber(0),
    lastUpdate: 0,
  };

  return balance;
}

export function getActiveBalances(balances: BalanceType[]): BalanceType[] {
  return balances.filter((b) => b.active);
}

export function getBalance(
  bankAddress: PublicKey,
  balances: BalanceType[]
): BalanceType {
  return (
    balances
      .filter((b) => b.active)
      .find((b) => b.bankPk.equals(bankAddress)) ??
    createEmptyBalance(bankAddress)
  );
}

export function computeLiquidationPriceForBank(
  bank: BankType,
  priceInfo: OraclePrice,
  marginfiAccount: MarginfiAccountType
): number | null {
  const balance = getBalance(bank.address, marginfiAccount.balances);

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

export function computeProjectedActiveBanksNoCpi(
  balances: BalanceType[],
  instructions: TransactionInstruction[],
  program: MarginfiProgram
): PublicKey[] {
  let projectedBalances = [
    ...balances.map((b) => ({ active: b.active, bankPk: b.bankPk })),
  ];

  for (let index = 0; index < instructions.length; index++) {
    const ix = instructions[index];

    if (!ix?.programId.equals(program.programId)) continue;

    const borshCoder = new BorshInstructionCoder(program.idl);
    const decoded = borshCoder.decode(ix.data, "base58");
    if (!decoded) continue;

    const ixArgs = decoded.data as any;

    switch (decoded.name) {
      case "lendingAccountBorrow":
      case "kaminoDeposit":
      case "lendingAccountDeposit": {
        const targetBank = new PublicKey(ix?.keys[3]!.pubkey);
        const targetBalance = projectedBalances.find((b) =>
          b.bankPk.equals(targetBank)
        );
        if (!targetBalance) {
          const firstInactiveBalanceIndex = projectedBalances.findIndex(
            (b) => !b.active
          );
          if (
            firstInactiveBalanceIndex === -1 ||
            !projectedBalances[firstInactiveBalanceIndex]
          ) {
            throw Error("No inactive balance found");
          }

          projectedBalances[firstInactiveBalanceIndex].active = true;
          projectedBalances[firstInactiveBalanceIndex].bankPk = targetBank;
        }
        break;
      }
      case "lendingAccountRepay":
      case "kaminoWithdraw":
      case "lendingAccountWithdraw": {
        const targetBank = new PublicKey(ix.keys[3]!.pubkey);
        const targetBalance = projectedBalances.find((b) =>
          b.bankPk.equals(targetBank)
        );
        if (!targetBalance) {
          throw Error(
            `Balance for bank ${targetBank.toBase58()} should be projected active at this point (ix ${index}: ${
              decoded.name
            }))`
          );
        }

        if (ixArgs.repayAll || ixArgs.withdrawAll) {
          targetBalance.active = false;
          targetBalance.bankPk = PublicKey.default;
        }
        break;
      }
      default: {
        continue;
      }
    }
  }

  return projectedBalances.filter((b) => b.active).map((b) => b.bankPk);
}

/**
 * Computes projected balances after applying a series of instructions.
 * Simulates how deposit/borrow/repay/withdraw instructions would change the account balances.
 *
 * This simulates both active/inactive state AND share amounts based on instruction arguments.
 *
 * @param balances - Current account balances
 * @param instructions - Instructions to simulate
 * @param program - Marginfi program for instruction decoding
 * @param bankMap - Map of bank addresses to bank data (needed for share value conversion)
 * @returns Projected balances after instructions are applied
 */
export function computeProjectedActiveBalancesNoCpi(
  balances: BalanceType[],
  instructions: TransactionInstruction[],
  program: MarginfiProgram,
  bankMap: Map<string, BankType>
): {
  projectedBalances: BalanceType[];
  impactedAssetsBanks: string[];
  impactedLiabilityBanks: string[];
} {
  // Deep clone all balances to avoid mutating original
  let projectedBalances: BalanceType[] = balances.map((b) => ({
    active: b.active,
    bankPk: b.bankPk,
    assetShares: new BigNumber(b.assetShares),
    liabilityShares: new BigNumber(b.liabilityShares),
    emissionsOutstanding: new BigNumber(b.emissionsOutstanding),
    lastUpdate: b.lastUpdate,
  }));

  const impactedAssetsBanks = new Set<string>();
  const impactedLiabilityBanks = new Set<string>();

  for (let index = 0; index < instructions.length; index++) {
    const ix = instructions[index];

    // Skip non-marginfi instructions
    if (!ix?.programId.equals(program.programId)) continue;

    const borshCoder = new BorshInstructionCoder(program.idl);
    const decoded = borshCoder.decode(ix.data, "base58");
    if (!decoded) continue;

    const ixArgs = decoded.data as any;

    switch (decoded.name) {
      // Instructions that open or add to a position
      case "lendingAccountDeposit":
      case "kaminoDeposit": {
        // Bank is at index 3 for these instructions (group, account, authority, bank, ...)
        const targetBank = new PublicKey(ix.keys[3]!.pubkey);
        impactedAssetsBanks.add(targetBank.toBase58());

        let targetBalance = projectedBalances.find((b) =>
          b.bankPk.equals(targetBank)
        );

        if (!targetBalance) {
          // Need to activate a new balance slot
          const firstInactiveBalanceIndex = projectedBalances.findIndex(
            (b) => !b.active
          );

          if (
            firstInactiveBalanceIndex === -1 ||
            !projectedBalances[firstInactiveBalanceIndex]
          ) {
            throw Error("No inactive balance found");
          }

          targetBalance = projectedBalances[firstInactiveBalanceIndex];
          targetBalance.active = true;
          targetBalance.bankPk = targetBank;
          targetBalance.assetShares = new BigNumber(0);
          targetBalance.liabilityShares = new BigNumber(0);
        }

        // Convert token amount to shares and add to asset shares
        const depositTokenAmount = new BigNumber(
          ixArgs.amount?.toString() || "0"
        );
        const bank = bankMap.get(targetBank.toBase58());
        if (!bank) {
          throw Error(`Bank ${targetBank.toBase58()} not found in bankMap`);
        }
        const depositShares = getAssetShares(bank, depositTokenAmount);
        targetBalance.assetShares =
          targetBalance.assetShares.plus(depositShares);
        break;
      }

      case "lendingAccountBorrow": {
        const targetBank = new PublicKey(ix.keys[3]!.pubkey);
        impactedLiabilityBanks.add(targetBank.toBase58());

        let targetBalance = projectedBalances.find((b) =>
          b.bankPk.equals(targetBank)
        );

        if (!targetBalance) {
          // Need to activate a new balance slot
          const firstInactiveBalanceIndex = projectedBalances.findIndex(
            (b) => !b.active
          );

          if (
            firstInactiveBalanceIndex === -1 ||
            !projectedBalances[firstInactiveBalanceIndex]
          ) {
            throw Error("No inactive balance found");
          }

          targetBalance = projectedBalances[firstInactiveBalanceIndex];
          targetBalance.active = true;
          targetBalance.bankPk = targetBank;
          targetBalance.assetShares = new BigNumber(0);
          targetBalance.liabilityShares = new BigNumber(0);
        }

        // Convert token amount to shares and add to liability shares
        const borrowTokenAmount = new BigNumber(
          ixArgs.amount?.toString() || "0"
        );
        const bank = bankMap.get(targetBank.toBase58());
        if (!bank) {
          throw Error(`Bank ${targetBank.toBase58()} not found in bankMap`);
        }
        const borrowShares = getLiabilityShares(bank, borrowTokenAmount);
        targetBalance.liabilityShares =
          targetBalance.liabilityShares.plus(borrowShares);
        break;
      }

      // Instructions that reduce or close positions
      case "lendingAccountRepay": {
        const targetBank = new PublicKey(ix.keys[3]!.pubkey);
        impactedLiabilityBanks.add(targetBank.toBase58());

        const targetBalance = projectedBalances.find((b) =>
          b.bankPk.equals(targetBank)
        );

        if (!targetBalance) {
          throw Error(
            `Balance for bank ${targetBank.toBase58()} should be projected active at this point (ix ${index}: ${
              decoded.name
            }))`
          );
        }

        // Check if this is a full repay
        if (ixArgs.repayAll) {
          targetBalance.liabilityShares = new BigNumber(0);

          // If no assets and no liabilities, close the balance
          if (targetBalance.assetShares.eq(0)) {
            targetBalance.active = false;
            targetBalance.bankPk = PublicKey.default;
          }
        } else {
          // Convert token amount to shares and subtract from liability shares
          const repayTokenAmount = new BigNumber(
            ixArgs.amount?.toString() || "0"
          );
          const bank = bankMap.get(targetBank.toBase58());
          if (!bank) {
            throw Error(`Bank ${targetBank.toBase58()} not found in bankMap`);
          }
          const repayShares = getLiabilityShares(bank, repayTokenAmount);
          targetBalance.liabilityShares = BigNumber.max(
            0,
            targetBalance.liabilityShares.minus(repayShares)
          );

          // If fully repaid and no assets, close the balance
          if (
            targetBalance.liabilityShares.eq(0) &&
            targetBalance.assetShares.eq(0)
          ) {
            targetBalance.active = false;
            targetBalance.bankPk = PublicKey.default;
          }
        }
        break;
      }

      case "lendingAccountWithdraw":
      case "kaminoWithdraw": {
        const targetBank = new PublicKey(ix.keys[3]!.pubkey);
        impactedAssetsBanks.add(targetBank.toBase58());

        const targetBalance = projectedBalances.find((b) =>
          b.bankPk.equals(targetBank)
        );

        if (!targetBalance) {
          throw Error(
            `Balance for bank ${targetBank.toBase58()} should be projected active at this point (ix ${index}: ${
              decoded.name
            }))`
          );
        }

        // Check if this is a full withdraw
        if (ixArgs.withdrawAll) {
          targetBalance.assetShares = new BigNumber(0);

          // If no assets and no liabilities, close the balance
          if (targetBalance.liabilityShares.eq(0)) {
            targetBalance.active = false;
            targetBalance.bankPk = PublicKey.default;
          }
        } else {
          // Convert token amount to shares and subtract from asset shares
          const withdrawTokenAmount = new BigNumber(
            ixArgs.amount?.toString() || "0"
          );
          const bank = bankMap.get(targetBank.toBase58());
          if (!bank) {
            throw Error(`Bank ${targetBank.toBase58()} not found in bankMap`);
          }
          const withdrawShares = getAssetShares(bank, withdrawTokenAmount);
          targetBalance.assetShares = BigNumber.max(
            0,
            targetBalance.assetShares.minus(withdrawShares)
          );

          // If fully withdrawn and no liabilities, close the balance
          if (
            targetBalance.assetShares.eq(0) &&
            targetBalance.liabilityShares.eq(0)
          ) {
            targetBalance.active = false;
            targetBalance.bankPk = PublicKey.default;
          }
        }
        break;
      }

      default: {
        // Ignore other instructions
        continue;
      }
    }
  }

  return {
    projectedBalances,
    impactedAssetsBanks: Array.from(impactedAssetsBanks),
    impactedLiabilityBanks: Array.from(impactedLiabilityBanks),
  };
}

export function computeHealthCacheStatus(
  activeBalances: BalanceType[],
  bankMap: Map<string, BankType>,
  oraclePrices: Map<string, OraclePrice>,
  activeEmodeWeights?: Record<
    string,
    {
      assetWeightInit: BigNumber;
      assetWeightMaint: BigNumber;
    }
  >
) {
  const { assets: assetValueEquity, liabilities: liabilityValueEquity } =
    computeHealthComponentsWithoutBiasLegacy(
      activeBalances,
      bankMap,
      oraclePrices,
      MarginRequirementType.Equity,
      activeEmodeWeights
    );

  const { assets: assetValueMaint, liabilities: liabilityValueMaint } =
    computeHealthComponentsLegacy(
      activeBalances,
      bankMap,
      oraclePrices,
      MarginRequirementType.Maintenance,
      [],
      activeEmodeWeights
    );

  const { assets: assetValueInitial, liabilities: liabilityValueInitial } =
    computeHealthComponentsLegacy(
      activeBalances,
      bankMap,
      oraclePrices,
      MarginRequirementType.Initial,
      [],
      activeEmodeWeights
    );

  const healthCache: HealthCacheType = {
    assetValue: assetValueInitial,
    liabilityValue: liabilityValueInitial,
    assetValueMaint: assetValueMaint,
    liabilityValueMaint: liabilityValueMaint,
    assetValueEquity: assetValueEquity,
    liabilityValueEquity: liabilityValueEquity,
    timestamp: new BigNumber(0),
    flags: [],
    prices: [],
    simulationStatus: HealthCacheStatus.COMPUTED,
  };

  return healthCache;
}

export function computeLiabilityHealthComponent(
  balances: BalanceType[],
  bankMap: Map<string, BankType>,
  oraclePrices: Map<string, OraclePrice>,
  liabilityBanks: PublicKey[],
  marginRequirementType: MarginRequirementType
): BigNumber {
  const liabilitySet = new Set(liabilityBanks.map((b) => b.toBase58()));

  // Filter to only include liability balances
  const liabilityBalances = balances.filter(
    (b) => b.active && liabilitySet.has(b.bankPk.toBase58())
  );

  const { liabilities } = computeHealthComponentsLegacy(
    liabilityBalances,
    bankMap,
    oraclePrices,
    marginRequirementType,
    []
  );

  return liabilities;
}

/**
 * Calculate asset health component for specific asset positions
 */
export function computeAssetHealthComponent(
  balances: BalanceType[],
  bankMap: Map<string, BankType>,
  oraclePrices: Map<string, OraclePrice>,
  assetBanks: PublicKey[],
  marginRequirementType: MarginRequirementType
): BigNumber {
  const assetSet = new Set(assetBanks.map((b) => b.toBase58()));

  // Filter to only include asset balances
  const assetBalances = balances.filter(
    (b) => b.active && assetSet.has(b.bankPk.toBase58())
  );

  const { assets } = computeHealthComponentsLegacy(
    assetBalances,
    bankMap,
    oraclePrices,
    marginRequirementType,
    []
  );

  return assets;
}
