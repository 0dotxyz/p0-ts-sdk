import { PublicKey } from "@solana/web3.js";
import { BigNumber } from "bignumber.js";

import { BalanceType, MarginRequirementType } from "../../types";

import {
  BankType,
  computeUsdValue,
  getAssetQuantity,
  getLiabilityQuantity,
  isWeightedPrice,
  RiskTier,
  SECONDS_PER_YEAR,
} from "~/services/bank";
import { PremiumEntry } from "~/services/group";
import { getPrice, OraclePrice, PriceBias } from "~/services/price";
import { Amount } from "~/types";

/**
 * Variable borrow premium owed by a balance, in native units of the bank's mint: the premium
 * already accrued into the balance plus simple interest at the stored rate since its last update,
 * counted from no earlier than the bank's premium activation. Zero unless the bank has premium
 * active and the balance is a liability. Mirrors the program's `accrued_premium_total`.
 *
 * @param balance - The balance to compute the premium for
 * @param bank - The balance's bank
 * @param nowSeconds - Unix time in seconds to accrue up to (default: now)
 * @returns Premium owed in native units
 */
export function computeBalancePremium(
  balance: BalanceType,
  bank: BankType,
  nowSeconds = Date.now() / 1000
): BigNumber {
  if (!bank.premiumActive || balance.liabilityShares.lte(0)) {
    return new BigNumber(0);
  }

  const accrualStart = Math.max(balance.lastUpdate, bank.premiumActivatedAt);
  const elapsedSeconds = balance.lastUpdate === 0 ? 0 : Math.max(0, nowSeconds - accrualStart);

  return balance.premiumOutstanding.plus(
    getLiabilityQuantity(bank, balance.liabilityShares)
      .times(balance.premiumRate)
      .times(elapsedSeconds)
      .div(SECONDS_PER_YEAR)
  );
}

/**
 * Account state needed to price premium rates
 */
export interface ComputePremiumRatesParams {
  /** Active account balances */
  activeBalances: BalanceType[];
  /** Map of bank addresses to bank data */
  banksMap: Map<string, BankType>;
  /** Map of bank addresses to oracle price data */
  oraclePricesByBank: Map<string, OraclePrice>;
  /** Asset share value multipliers by bank address (for integrated protocols like Kamino/Drift) */
  assetShareValueMultiplierByBank?: Map<string, BigNumber>;
  /** The group's premium table (`MarginfiGroup.premiumEntries`) */
  premiumEntries: PremiumEntry[];
}

/**
 * Premium rate (APR fraction, 0.05 = 5%) the program would write for a liability in each
 * premium-active bank, given the account's current collateral: "your premium if you borrow here",
 * and the refreshed rate of existing debt.
 *
 * Mirrors the program's snapshot refresh: the collateral-USD-weighted average of each collateral's
 * pair rate. Collateral is valued unweighted at the Initial-requirement low price; isolated
 * collateral and collateral with a zero base maintenance weight are left out, untagged collateral
 * counts at 0%.
 *
 * @param params - Account state and the group's premium table
 * @returns Rate by bank address, for every premium-active bank in `banksMap`
 */
export function computePremiumRatesByBank(
  params: ComputePremiumRatesParams
): Map<string, BigNumber> {
  const collateral = computePremiumCollateral(params);
  const rates = new Map<string, BigNumber>();
  for (const [bankKey, bank] of params.banksMap) {
    if (bank.premiumActive) {
      rates.set(bankKey, computePremiumRate(collateral, params.premiumEntries, bank.premiumTag));
    }
  }
  return rates;
}

/**
 * An action whose effect on premium rates is previewed by {@link computePremiumImpact}
 */
export interface PremiumAction {
  type: "deposit" | "withdraw" | "borrow" | "repay";
  bank: PublicKey;
  /** Amount in UI units of the bank's underlying token, as the action builders take it */
  amount: Amount;
}

/**
 * How a set of actions changes the account's variable borrow premium
 */
export interface PremiumImpact {
  /**
   * The rates in `liabilities` apply as soon as the transaction lands: the actions refresh them
   * on-chain (borrow, withdraw), or the SDK adds `pulse_health` because premium-bearing debt
   * remains. Otherwise they apply from the next borrow, withdraw or pulse.
   */
  refreshes: boolean;
  /**
   * Every premium-active debt after the actions, by bank address: the stored rate before (absent
   * for a new borrow) and the refreshed rate after. APR fractions.
   */
  liabilities: Map<string, { before?: BigNumber; after: BigNumber }>;
  /** Yearly premium in USD across those debts: principal x rate, before and after */
  annualPremiumUsd: { before: BigNumber; after: BigNumber };
}

/**
 * Previews how deposits, withdrawals, borrows and repays change every open borrow's premium
 * rate and the account's yearly premium. Pass one action for a single action, or all legs of a
 * flow (loop, collateral or debt swap, repay with collateral) to preview the end state.
 *
 * @param params - Account state, the group's premium table and the actions
 * @returns Rates before and after per premium-active debt, and the yearly premium
 */
export function computePremiumImpact(
  params: ComputePremiumRatesParams & { actions: PremiumAction[] }
): PremiumImpact {
  const { activeBalances, banksMap, oraclePricesByBank, premiumEntries, actions } = params;
  const nowSeconds = Date.now() / 1000;

  const collateral = computePremiumCollateral(params);
  const debts = new Map<
    string,
    { bank: BankType; principal: BigNumber; premiumOwed: BigNumber; storedRate?: BigNumber }
  >();
  for (const balance of activeBalances) {
    const bank = banksMap.get(balance.bankPk.toBase58());
    if (!bank?.premiumActive || balance.liabilityShares.lte(0)) continue;
    const scale = 10 ** bank.mintDecimals;
    debts.set(balance.bankPk.toBase58(), {
      bank,
      principal: getLiabilityQuantity(bank, balance.liabilityShares).div(scale),
      premiumOwed: computeBalancePremium(balance, bank, nowSeconds).div(scale),
      storedRate: balance.premiumRate,
    });
  }

  const annualPremiumUsdBefore = sumAnnualPremiumUsd(
    [...debts.values()].map((debt) => ({ ...debt, rate: debt.storedRate ?? new BigNumber(0) })),
    oraclePricesByBank
  );

  for (const action of actions) {
    const bankKey = action.bank.toBase58();
    const bank = banksMap.get(bankKey);
    if (!bank) continue;
    const amount = new BigNumber(action.amount);

    switch (action.type) {
      case "deposit":
      case "withdraw": {
        const oraclePrice = oraclePricesByBank.get(bankKey);
        if (!oraclePrice || !countsAsPremiumCollateral(bank)) break;
        const delta = amount.times(
          getPrice(oraclePrice, PriceBias.Lowest, isWeightedPrice(MarginRequirementType.Initial))
        );
        const usd = collateral.get(bankKey)?.usd ?? new BigNumber(0);
        collateral.set(bankKey, {
          tag: bank.premiumTag,
          usd: action.type === "deposit" ? usd.plus(delta) : BigNumber.max(0, usd.minus(delta)),
        });
        break;
      }
      case "borrow": {
        if (!bank.premiumActive) break;
        const debt = debts.get(bankKey);
        debts.set(bankKey, {
          bank,
          principal: (debt?.principal ?? new BigNumber(0)).plus(amount),
          premiumOwed: debt?.premiumOwed ?? new BigNumber(0),
          storedRate: debt?.storedRate,
        });
        break;
      }
      case "repay": {
        const debt = debts.get(bankKey);
        if (!debt) break;
        const premiumPaid = BigNumber.min(debt.premiumOwed, amount);
        const principal = debt.principal.minus(amount.minus(premiumPaid));
        if (principal.lte(0)) {
          debts.delete(bankKey);
        } else {
          debts.set(bankKey, {
            ...debt,
            principal,
            premiumOwed: debt.premiumOwed.minus(premiumPaid),
          });
        }
        break;
      }
    }
  }

  const liabilities = new Map<string, { before?: BigNumber; after: BigNumber }>();
  const debtsAfter = [];
  for (const [bankKey, debt] of debts) {
    const after = computePremiumRate(collateral, premiumEntries, debt.bank.premiumTag);
    liabilities.set(bankKey, { before: debt.storedRate, after });
    debtsAfter.push({ ...debt, rate: after });
  }

  return {
    refreshes:
      liabilities.size > 0 ||
      actions.some((action) => action.type === "borrow" || action.type === "withdraw"),
    liabilities,
    annualPremiumUsd: {
      before: annualPremiumUsdBefore,
      after: sumAnnualPremiumUsd(debtsAfter, oraclePricesByBank),
    },
  };
}

function countsAsPremiumCollateral(bank: BankType): boolean {
  return bank.config.riskTier !== RiskTier.Isolated && bank.config.assetWeightMaint.gt(0);
}

function computePremiumCollateral({
  activeBalances,
  banksMap,
  oraclePricesByBank,
  assetShareValueMultiplierByBank,
}: ComputePremiumRatesParams): Map<string, { tag: number; usd: BigNumber }> {
  const collateral = new Map<string, { tag: number; usd: BigNumber }>();
  for (const balance of activeBalances) {
    const bankKey = balance.bankPk.toBase58();
    const bank = banksMap.get(bankKey);
    const oraclePrice = oraclePricesByBank.get(bankKey);
    if (!bank || !oraclePrice || balance.assetShares.lte(0) || !countsAsPremiumCollateral(bank)) {
      continue;
    }
    collateral.set(bankKey, {
      tag: bank.premiumTag,
      usd: computeUsdValue({
        bank,
        oraclePrice,
        quantity: getAssetQuantity(bank, balance.assetShares),
        priceBias: PriceBias.Lowest,
        isWeightedPrice: isWeightedPrice(MarginRequirementType.Initial),
        assetShareValueMultiplier: assetShareValueMultiplierByBank?.get(bankKey),
      }),
    });
  }
  return collateral;
}

function computePremiumRate(
  collateral: Map<string, { tag: number; usd: BigNumber }>,
  premiumEntries: PremiumEntry[],
  liabilityTag: number
): BigNumber {
  let totalUsd = new BigNumber(0);
  let weightedUsd = new BigNumber(0);
  for (const { tag, usd } of collateral.values()) {
    const pairRate = premiumEntries.find(
      (entry) => entry.collateralTag === tag && entry.liabilityTag === liabilityTag
    )?.rate;
    totalUsd = totalUsd.plus(usd);
    if (pairRate) weightedUsd = weightedUsd.plus(usd.times(pairRate));
  }
  return totalUsd.gt(0) ? weightedUsd.div(totalUsd) : new BigNumber(0);
}

function sumAnnualPremiumUsd(
  debts: { bank: BankType; principal: BigNumber; rate: BigNumber }[],
  oraclePricesByBank: Map<string, OraclePrice>
): BigNumber {
  return debts.reduce((sum, { bank, principal, rate }) => {
    const oraclePrice = oraclePricesByBank.get(bank.address.toBase58());
    return oraclePrice ? sum.plus(principal.times(getPrice(oraclePrice)).times(rate)) : sum;
  }, new BigNumber(0));
}
