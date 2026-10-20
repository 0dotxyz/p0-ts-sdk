import { BigNumber } from "bignumber.js";

import { BankType } from "../types";

import { Amount } from "~/types";
import { toBigNumber } from "~/utils";

/**
 * Computes the maximum leverage achievable between deposit and borrow banks.
 *
 * Max leverage is determined by the loan-to-value (LTV) ratio, which is the ratio
 * of asset weight to liability weight. The formula is: `maxLeverage = 1 / (1 - LTV)`.
 *
 * @param depositBank - The bank being used as collateral
 * @param borrowBank - The bank being borrowed against
 * @param opts - Optional weight overrides
 * @param opts.assetWeightInit - Override deposit bank's initial asset weight
 * @param opts.liabilityWeightInit - Override borrow bank's initial liability weight
 * @returns Object containing maxLeverage and ltv (loan-to-value ratio)
 *
 * @example
 * ```typescript
 * const { maxLeverage, ltv } = computeMaxLeverage(solBank, usdcBank);
 * console.log(`Max leverage: ${maxLeverage.toFixed(2)}x, LTV: ${(ltv * 100).toFixed(1)}%`);
 * ```
 */
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

/**
 * Computes the total deposit and borrow amounts needed to achieve a target leverage.
 *
 * This is used for leveraged looping strategies where you:
 * 1. Deposit collateral
 * 2. Borrow against it
 * 3. Swap borrowed assets to deposit asset
 * 4. Repeat to achieve desired leverage
 *
 * The target leverage is automatically clamped between 1x and the maximum achievable leverage.
 *
 * @param principal - Initial collateral amount (in deposit token)
 * @param targetLeverage - Desired leverage multiplier (e.g., 3 for 3x)
 * @param depositBank - The bank receiving deposits
 * @param borrowBank - The bank being borrowed from
 * @param depositOracleInfo - Oracle price for deposit asset
 * @param borrowOracleInfo - Oracle price for borrow asset
 * @param opts - Optional weight overrides
 * @returns Total amounts needed (totalDepositAmount, totalBorrowAmount)
 *
 * @example
 * ```typescript
 * const { totalDepositAmount, totalBorrowAmount } = computeLoopingParams(
 *   new BigNumber(1000), // 1000 SOL principal
 *   3,                   // 3x leverage
 *   solBank,
 *   usdcBank,
 *   solOraclePrice,
 *   usdcOraclePrice
 * );
 * ```
 */
export function computeLoopingParams(
  principal: Amount,
  targetLeverage: number,
  depositBank: BankType,
  borrowBank: BankType,
  depositPriceUsd: number,
  borrowPriceUsd: number,
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
    .times(new BigNumber(depositPriceUsd))
    .div(new BigNumber(borrowPriceUsd));

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
