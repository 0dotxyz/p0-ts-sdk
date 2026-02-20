import BigNumber from "bignumber.js";

import {
  BankType,
  computeInterestRates,
  getAssetWeight,
  getLiabilityWeight,
} from "~/services/bank";
import { getPrice, OraclePrice, PriceBias } from "~/services/price";
import { aprToApy, shortenAddress } from "~/utils";

import { MarginfiAccountType, BalanceType, MarginRequirementType } from "../../types";
import { computeHealthComponentsFromCache } from "./health-compute.utils";
import { computeBalanceUsdValue, computeQuantityUi } from "./balance-value-compute.utils";
import { getBalance } from "./balance-helper.utils";

/**
 * Account-Level Metrics
 * ====================
 */

export function computeAccountValue(marginfiAccount: MarginfiAccountType): BigNumber {
  const { assets, liabilities } = computeHealthComponentsFromCache(
    marginfiAccount,
    MarginRequirementType.Equity
  );
  return assets.minus(liabilities);
}

/**
 * Configuration for computing net APY
 */
export interface ComputeNetApyParams {
  /** The marginfi account to compute net APY for */
  marginfiAccount: MarginfiAccountType;
  /** Active balances in the account */
  activeBalances: BalanceType[];
  /** Map of banks by their address */
  banksMap: Map<string, BankType>;
  /** Map of oracle prices by bank address */
  oraclePricesByBank: Map<string, OraclePrice>;
  /** Asset share value multipliers by bank address (for integrated protocols like Kamino/Drift) */
  assetShareValueMultiplierByBank?: Map<string, BigNumber>;
  /** Optional emode weight overrides by bank address */
  activeEmodeWeightsByBank?: Map<
    string,
    { assetWeightInit: BigNumber; assetWeightMaint: BigNumber }
  >;
}

/**
 * Computes the net APY (Annual Percentage Yield) for a marginfi account.
 *
 * The net APY represents the combined annualized return from all lending and borrowing
 * positions in the account, weighted by their USD values.
 *
 * **Calculation:**
 * 1. Computes weighted APR contributions from each position:
 *    - **Lending positions**: Positive contribution (earning interest)
 *    - **Borrowing positions**: Negative contribution (paying interest)
 * 2. Weights each position by its USD value relative to total account value
 * 3. Converts the final APR to APY (accounts for compounding)
 *
 * **Example:**
 * - Account has $1000 net value
 * - $800 lent at 5% APR = +4% contribution to net APR
 * - $600 borrowed at 3% APR = -1.8% contribution to net APR
 * - Net APR = +2.2%, converted to APY
 *
 * @param params - Configuration object for net APY computation
 * @returns Net APY as a decimal (e.g., 0.05 for 5% APY)
 *
 * @example
 * ```typescript
 * const netApy = computeNetApy({
 *   marginfiAccount: account,
 *   activeBalances: account.balances.filter(b => b.active),
 *   banksMap: client.bankMap,
 *   oraclePricesByBank: client.oraclePriceByBank,
 * });
 * console.log(`Net APY: ${(netApy * 100).toFixed(2)}%`);
 * ```
 */
export function computeNetApy(params: ComputeNetApyParams): number {
  const {
    marginfiAccount,
    activeBalances,
    banksMap,
    oraclePricesByBank,
    assetShareValueMultiplierByBank,
    activeEmodeWeightsByBank,
  } = params;

  const { assets, liabilities } = computeHealthComponentsFromCache(
    marginfiAccount,
    MarginRequirementType.Equity
  );
  const totalUsdValue = assets.minus(liabilities);
  const apr = activeBalances
    .reduce((weightedApr, balance) => {
      const bankKey = balance.bankPk.toBase58();
      const bank = banksMap.get(bankKey);
      if (!bank) {
        console.warn(
          `Bank ${shortenAddress(balance.bankPk)} not found, excluding from APY computation`
        );
        return weightedApr;
      }

      const oraclePrice = oraclePricesByBank.get(bankKey);
      if (!oraclePrice) {
        console.warn(
          `Price info for bank ${shortenAddress(balance.bankPk)} not found, excluding from APY computation`
        );
        return weightedApr;
      }

      const assetShareValueMultiplier = assetShareValueMultiplierByBank?.get(bankKey);
      const activeEmodeWeights = activeEmodeWeightsByBank?.get(bankKey);

      return weightedApr
        .minus(
          computeInterestRates(bank)
            .borrowingRate.times(
              computeBalanceUsdValue({
                balance,
                bank,
                oraclePrice,
                marginRequirement: MarginRequirementType.Equity,
              }).liabilities
            )
            .div(totalUsdValue.isEqualTo(0) ? 1 : totalUsdValue)
        )
        .plus(
          computeInterestRates(bank)
            .lendingRate.times(
              computeBalanceUsdValue({
                balance,
                bank,
                oraclePrice,
                marginRequirement: MarginRequirementType.Equity,
                assetShareValueMultiplier,
                activeEmodeWeights,
              }).assets
            )
            .div(totalUsdValue.isEqualTo(0) ? 1 : totalUsdValue)
        );
    }, new BigNumber(0))
    .toNumber();

  return aprToApy(apr);
}

/**
 * Configuration for computing liquidation price for a bank position
 */
export interface ComputeLiquidationPriceForBankParams {
  /** The bank to compute liquidation price for */
  bank: BankType;
  /** Oracle price data for the bank */
  oraclePrice: OraclePrice;
  /** The marginfi account containing the position */
  marginfiAccount: MarginfiAccountType;
  /** Asset share value multiplier for integrated protocols (Kamino, Drift) */
  assetShareValueMultiplier?: BigNumber;
  /** Optional emode weight overrides */
  activeEmodeWeights?: {
    assetWeightInit: BigNumber;
    assetWeightMaint: BigNumber;
  };
}

/**
 * Computes the liquidation price for a specific bank position.
 *
 * The liquidation price is the asset price at which the account would be liquidated
 * based on the current position in this bank and all other positions in the account.
 *
 * **For lending (asset) positions:**
 * - Price where asset value (weighted) + other assets = liabilities
 * - Lower prices mean less collateral value → liquidation risk
 *
 * **For borrowing (liability) positions:**
 * - Price where assets = liability value (weighted) + other liabilities
 * - Higher prices mean more debt value → liquidation risk
 *
 * Uses maintenance margin requirements and includes oracle price confidence bands.
 *
 * @param params - Configuration object for liquidation price computation
 * @returns Liquidation price in token terms, or null if:
 *   - Position is inactive
 *   - Account has no liabilities (for lending positions)
 *   - Calculation results in invalid number (NaN, negative, infinite)
 *
 * @example
 * ```typescript
 * // Lending position: at what SOL price would I get liquidated?
 * const liqPrice = computeLiquidationPriceForBank({
 *   bank: solBank,
 *   oraclePrice: solOraclePrice,
 *   marginfiAccount: account,
 * });
 * if (liqPrice) {
 *   console.log(`Liquidation at $${liqPrice.toFixed(2)} per SOL`);
 * }
 * ```
 */
export function computeLiquidationPriceForBank(
  params: ComputeLiquidationPriceForBankParams
): number | null {
  const { bank, oraclePrice, marginfiAccount, assetShareValueMultiplier, activeEmodeWeights } =
    params;

  const balance = getBalance(bank.address, marginfiAccount.balances);

  if (!balance.active) return null;

  const { assets: assetBank, liabilities: liabilitiesBank } = computeBalanceUsdValue({
    balance,
    bank,
    oraclePrice,
    marginRequirement: MarginRequirementType.Maintenance,
    assetShareValueMultiplier,
    activeEmodeWeights,
  });

  const { assets: assetsAccount, liabilities: liabilitiesAccount } =
    computeHealthComponentsFromCache(marginfiAccount, MarginRequirementType.Maintenance);

  const assets = assetsAccount.minus(assetBank);
  const liabilities = liabilitiesAccount.minus(liabilitiesBank);

  const isLending = balance.liabilityShares.isZero();
  const { assets: assetQuantityUi, liabilities: liabQuantitiesUi } = computeQuantityUi(
    balance,
    bank
  );

  let liquidationPrice: BigNumber;
  if (isLending) {
    if (liabilities.eq(0)) return null;

    const assetWeight = getAssetWeight({
      bank,
      marginRequirement: MarginRequirementType.Maintenance,
      oraclePrice,
      assetShareValueMultiplier,
      activeEmodeWeights,
    });
    const priceConfidence = getPrice(oraclePrice, PriceBias.None, false).minus(
      getPrice(oraclePrice, PriceBias.Lowest, false)
    );
    liquidationPrice = liabilities
      .minus(assets)
      .div(assetQuantityUi.times(assetWeight))
      .plus(priceConfidence);
  } else {
    const liabWeight = getLiabilityWeight(bank.config, MarginRequirementType.Maintenance);
    const priceConfidence = getPrice(oraclePrice, PriceBias.Highest, false).minus(
      getPrice(oraclePrice, PriceBias.None, false)
    );
    liquidationPrice = assets
      .minus(liabilities)
      .div(liabQuantitiesUi.times(liabWeight))
      .minus(priceConfidence);
  }
  if (liquidationPrice.isNaN() || liquidationPrice.lt(0) || !liquidationPrice.isFinite())
    return null;
  return liquidationPrice.toNumber();
}
