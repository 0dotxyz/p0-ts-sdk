import { BigNumber } from "bignumber.js";

import { BankType } from "../types";

import { getTotalAssetQuantity, getTotalLiabilityQuantity } from "./shares.utils";

export function computeInterestRates(bank: BankType): {
  lendingRate: BigNumber;
  borrowingRate: BigNumber;
} {
  const { insuranceFeeFixedApr, insuranceIrFee, protocolFixedFeeApr, protocolIrFee } =
    bank.config.interestRateConfig;

  const fixedFee = insuranceFeeFixedApr.plus(protocolFixedFeeApr);
  const rateFee = insuranceIrFee.plus(protocolIrFee);

  const baseInterestRate = computeBaseInterestRate(bank);
  const utilizationRate = computeUtilizationRate(bank);

  const lendingRate = baseInterestRate.times(utilizationRate);
  const borrowingRate = baseInterestRate.times(new BigNumber(1).plus(rateFee)).plus(fixedFee);

  return { lendingRate, borrowingRate };
}

const U32_MAX = 0xffffffff;

// Rates are encoded out of 1000%, so u32::MAX is an APR of 10.
function rateFromU32(rate: number): BigNumber {
  const ratio = new BigNumber(rate).div(U32_MAX);
  return ratio.times(10);
}

function calculateRateBetweenPoints(
  startX: BigNumber,
  startY: BigNumber,
  endX: BigNumber,
  endY: BigNumber,
  targetX: BigNumber
): BigNumber {
  if (endX.lte(startX)) return startY;
  if (targetX.lt(startX)) return startY;
  if (targetX.gt(endX)) return endY;
  if (endY.lt(startY)) return startY;

  const deltaX = endX.minus(startX);
  if (deltaX.isZero()) return startY;

  const offset = targetX.minus(startX);
  const proportion = offset.div(deltaX);
  const deltaY = endY.minus(startY);
  const scaledDelta = deltaY.times(proportion);

  return startY.plus(scaledDelta);
}

function computeLegacyCurve(
  utilizationRate: BigNumber,
  optimalUtilizationRate: BigNumber,
  plateauInterestRate: BigNumber,
  maxInterestRate: BigNumber
): BigNumber {
  if (utilizationRate.lte(optimalUtilizationRate)) {
    return utilizationRate.times(plateauInterestRate).div(optimalUtilizationRate);
  } else {
    return utilizationRate
      .minus(optimalUtilizationRate)
      .div(new BigNumber(1).minus(optimalUtilizationRate))
      .times(maxInterestRate.minus(plateauInterestRate))
      .plus(plateauInterestRate);
  }
}

function computeMultipointCurve(
  utilizationRate: BigNumber,
  zeroUtilRate: number,
  hundredUtilRate: number,
  points: Array<{ util: number; rate: number }>
): BigNumber {
  const zeroRate = rateFromU32(zeroUtilRate);
  const hundredRate = rateFromU32(hundredUtilRate);

  const clampedUtilizationRate = BigNumber.max(0, BigNumber.min(1, utilizationRate));

  // Points with util = 0 are unused padding on-chain.
  const nonPaddingPoints = points.filter((point) => point.util !== 0);

  let prevUtil = new BigNumber(0);
  let prevRate = zeroRate;

  for (const point of nonPaddingPoints) {
    const pointUtil = new BigNumber(point.util).div(U32_MAX);
    const pointRate = rateFromU32(point.rate);

    if (clampedUtilizationRate.lte(pointUtil)) {
      return calculateRateBetweenPoints(
        prevUtil,
        prevRate,
        pointUtil,
        pointRate,
        clampedUtilizationRate
      );
    }

    prevUtil = pointUtil;
    prevRate = pointRate;
  }

  return calculateRateBetweenPoints(
    prevUtil,
    prevRate,
    new BigNumber(1),
    hundredRate,
    clampedUtilizationRate
  );
}

export function computeBaseInterestRate(bank: BankType): BigNumber {
  const interestRateConfig = bank.config.interestRateConfig;
  const utilizationRate = computeUtilizationRate(bank);
  const curveType = interestRateConfig.curveType;

  // curveType 0 banks never migrated to the 7-point curve; their legacy params still sit in the
  // deprecated placeholder slots, which other curve types may reuse.
  if (curveType === 0) {
    return computeLegacyCurve(
      utilizationRate,
      interestRateConfig.placeholder0,
      interestRateConfig.placeholder1,
      interestRateConfig.placeholder2
    );
  }

  return computeMultipointCurve(
    utilizationRate,
    interestRateConfig.zeroUtilRate,
    interestRateConfig.hundredUtilRate,
    interestRateConfig.points
  );
}

export function computeUtilizationRate(bank: BankType): BigNumber {
  const assets = getTotalAssetQuantity(bank);
  const liabilities = getTotalLiabilityQuantity(bank);
  if (assets.isZero()) return new BigNumber(0);
  return liabilities.div(assets);
}
