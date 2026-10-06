import type { Address } from "@solana/kit";
import { BigNumber } from "bignumber.js";

import { BalanceType, MarginRequirementType } from "../types";

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
      rates.set(
        bankKey,
        breakdownPremium(collateral, params.premiumEntries, bank.premiumTag).reduce(
          (rate, row) => rate.plus(row.contributionApr),
          new BigNumber(0)
        )
      );
    }
  }
  return rates;
}

/**
 * One collateral's part in a liability's premium rate
 */
export interface PremiumCollateralBreakdown {
  /** Collateral bank address */
  bank: Address;
  /** The collateral bank's premium tag (0 = untagged) */
  tag: number;
  /** Collateral USD counted toward the rate: unweighted, at the Initial-requirement low price */
  usd: BigNumber;
  /** Rate of this collateral's tag against the liability's tag (APR fraction); 0 without a pair */
  pairRate: BigNumber;
  /** usd x pairRate / total collateral USD; the rows sum to the liability's rate */
  contributionApr: BigNumber;
}

/**
 * Per-collateral breakdown of the rate {@link computePremiumRatesByBank} gives `liabilityBank`:
 * one row per collateral that counts toward premium. Isolated, zero-maintenance-weight and unpriced
 * collateral are left out, as on-chain.
 *
 * @param params - Account state and the group's premium table
 * @param liabilityBank - The premium-active bank borrowed from (or to be borrowed from)
 * @returns Rows whose `contributionApr` sums to the rate; empty when the bank has no premium
 */
export function computePremiumBreakdown(
  params: ComputePremiumRatesParams,
  liabilityBank: Address
): PremiumCollateralBreakdown[] {
  const bank = params.banksMap.get(liabilityBank);
  if (!bank?.premiumActive) return [];
  return breakdownPremium(computePremiumCollateral(params), params.premiumEntries, bank.premiumTag);
}

/**
 * An action whose effect on premium rates is previewed by {@link computePremiumImpact}
 */
export interface PremiumAction {
  type: "deposit" | "withdraw" | "borrow" | "repay";
  bank: Address;
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
   * for a new borrow), the refreshed rate after (APR fractions), and the per-collateral breakdown
   * of the rate after.
   */
  liabilities: Map<
    string,
    { before?: BigNumber; after: BigNumber; breakdown: PremiumCollateralBreakdown[] }
  >;
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
    const bank = banksMap.get(balance.bankPk);
    if (!bank?.premiumActive || balance.liabilityShares.lte(0)) continue;
    const scale = 10 ** bank.mintDecimals;
    debts.set(balance.bankPk, {
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
    const bank = banksMap.get(action.bank);
    if (!bank) continue;
    const amount = new BigNumber(action.amount);

    switch (action.type) {
      case "deposit":
      case "withdraw": {
        const oraclePrice = oraclePricesByBank.get(action.bank);
        if (!oraclePrice || !countsAsPremiumCollateral(bank)) break;
        const delta = amount.times(
          getPrice(oraclePrice, PriceBias.Lowest, isWeightedPrice(MarginRequirementType.Initial))
        );
        const usd = collateral.get(action.bank)?.usd ?? new BigNumber(0);
        collateral.set(action.bank, {
          bank: action.bank,
          tag: bank.premiumTag,
          usd: action.type === "deposit" ? usd.plus(delta) : BigNumber.max(0, usd.minus(delta)),
        });
        break;
      }
      case "borrow": {
        if (!bank.premiumActive) break;
        const debt = debts.get(action.bank);
        debts.set(action.bank, {
          bank,
          principal: (debt?.principal ?? new BigNumber(0)).plus(amount),
          premiumOwed: debt?.premiumOwed ?? new BigNumber(0),
          storedRate: debt?.storedRate,
        });
        break;
      }
      case "repay": {
        const debt = debts.get(action.bank);
        if (!debt) break;
        const premiumPaid = BigNumber.min(debt.premiumOwed, amount);
        const principal = debt.principal.minus(amount.minus(premiumPaid));
        if (principal.lte(0)) {
          debts.delete(action.bank);
        } else {
          debts.set(action.bank, {
            ...debt,
            principal,
            premiumOwed: debt.premiumOwed.minus(premiumPaid),
          });
        }
        break;
      }
    }
  }

  const liabilities: PremiumImpact["liabilities"] = new Map();
  const debtsAfter = [];
  for (const [bankKey, debt] of debts) {
    const breakdown = breakdownPremium(collateral, premiumEntries, debt.bank.premiumTag);
    const after = breakdown.reduce((rate, row) => rate.plus(row.contributionApr), new BigNumber(0));
    liabilities.set(bankKey, { before: debt.storedRate, after, breakdown });
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
}: ComputePremiumRatesParams): Map<
  string,
  Pick<PremiumCollateralBreakdown, "bank" | "tag" | "usd">
> {
  const collateral = new Map<string, Pick<PremiumCollateralBreakdown, "bank" | "tag" | "usd">>();
  for (const balance of activeBalances) {
    const bank = banksMap.get(balance.bankPk);
    const oraclePrice = oraclePricesByBank.get(balance.bankPk);
    if (!bank || !oraclePrice || balance.assetShares.lte(0) || !countsAsPremiumCollateral(bank)) {
      continue;
    }
    collateral.set(balance.bankPk, {
      bank: balance.bankPk,
      tag: bank.premiumTag,
      usd: computeUsdValue({
        bank,
        oraclePrice,
        quantity: getAssetQuantity(bank, balance.assetShares),
        priceBias: PriceBias.Lowest,
        isWeightedPrice: isWeightedPrice(MarginRequirementType.Initial),
        assetShareValueMultiplier: assetShareValueMultiplierByBank?.get(balance.bankPk),
      }),
    });
  }
  return collateral;
}

function breakdownPremium(
  collateral: Map<string, Pick<PremiumCollateralBreakdown, "bank" | "tag" | "usd">>,
  premiumEntries: PremiumEntry[],
  liabilityTag: number
): PremiumCollateralBreakdown[] {
  const counted = [...collateral.values()].filter(({ usd }) => usd.gt(0));
  const totalUsd = counted.reduce((sum, { usd }) => sum.plus(usd), new BigNumber(0));
  return counted.map(({ bank, tag, usd }) => {
    const pairRate =
      premiumEntries.find(
        (entry) => entry.collateralTag === tag && entry.liabilityTag === liabilityTag
      )?.rate ?? new BigNumber(0);
    return { bank, tag, usd, pairRate, contributionApr: usd.times(pairRate).div(totalUsd) };
  });
}

function sumAnnualPremiumUsd(
  debts: { bank: BankType; principal: BigNumber; rate: BigNumber }[],
  oraclePricesByBank: Map<string, OraclePrice>
): BigNumber {
  return debts.reduce((sum, { bank, principal, rate }) => {
    const oraclePrice = oraclePricesByBank.get(bank.address);
    return oraclePrice ? sum.plus(principal.times(getPrice(oraclePrice)).times(rate)) : sum;
  }, new BigNumber(0));
}
