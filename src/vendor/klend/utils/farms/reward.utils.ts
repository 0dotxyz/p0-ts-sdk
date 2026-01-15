import Decimal from "decimal.js";
import { FarmStateRaw, ReserveRaw, RewardInfoFields } from "../../types";
import { PublicKey } from "@solana/web3.js";
import { getTotalSupply } from "../klend/interest-rate.utils";

export function getRewardPerTimeUnitSecond(reward: RewardInfoFields) {
  const now = new Decimal(new Date().getTime()).div(1000);
  let rewardPerTimeUnitSecond = new Decimal(0);
  for (let i = 0; i < reward.rewardScheduleCurve.points.length - 1; i++) {
    const currentPoint = reward.rewardScheduleCurve.points[i];
    const nextPoint = reward.rewardScheduleCurve.points[i + 1];

    if (!currentPoint || !nextPoint) {
      continue;
    }

    const { tsStart: tsStartThisPoint, rewardPerTimeUnit } = currentPoint;
    const { tsStart: tsStartNextPoint } = nextPoint;

    const thisPeriodStart = new Decimal(tsStartThisPoint.toString());
    const thisPeriodEnd = new Decimal(tsStartNextPoint.toString());
    const rps = new Decimal(rewardPerTimeUnit.toString());
    if (thisPeriodStart <= now && thisPeriodEnd >= now) {
      rewardPerTimeUnitSecond = rps;
      break;
    } else if (thisPeriodStart > now && thisPeriodEnd > now) {
      rewardPerTimeUnitSecond = rps;
      break;
    }
  }

  const rewardTokenDecimals = reward.token.decimals.toNumber();
  const rewardAmountPerUnitDecimals = new Decimal(10).pow(
    reward.rewardsPerSecondDecimals.toString()
  );
  const rewardAmountPerUnitLamports = new Decimal(10).pow(
    rewardTokenDecimals.toString()
  );

  const rpsAdjusted = new Decimal(rewardPerTimeUnitSecond.toString())
    .div(rewardAmountPerUnitDecimals)
    .div(rewardAmountPerUnitLamports);

  return rewardPerTimeUnitSecond ? rpsAdjusted : new Decimal(0);
}

export async function getReserveRewardsApy(
  priceByMint: Record<string, number>,
  farmState: FarmStateRaw,
  reserveState: ReserveRaw
) {
  const rewardApys: {
    rewardApy: Decimal;
    rewardInfo: RewardInfoFields;
    rewardApr: Decimal;
  }[] = [];

  for (const rewardInfo of farmState!.rewardInfos.filter(
    (x) => x.token.mint !== new PublicKey("11111111111111111111111111111111")
  )) {
    // Skip if we don't have prices for reserve or reward token
    const reserveMint = reserveState.liquidity.mintPubkey.toString();
    const rewardMint = rewardInfo.token.mint.toString();

    const reservePrice = priceByMint[reserveMint];
    const rewardPrice = priceByMint[rewardMint];

    // Check for undefined or null (but allow 0 as a valid price)
    if (
      reservePrice === undefined ||
      reservePrice === null ||
      rewardPrice === undefined ||
      rewardPrice === null
    ) {
      continue;
    }

    const { apy, apr } = calculateRewardApy(
      priceByMint,
      reserveState,
      rewardInfo
    );
    rewardApys.push({ rewardApy: apy, rewardInfo, rewardApr: apr });
  }

  return rewardApys;
}

export function calculateRewardApy(
  priceByMint: Record<string, number>,
  reserve: ReserveRaw,
  rewardInfo: RewardInfoFields
) {
  const decimals = reserve.liquidity.mintDecimals.toNumber();
  const totalSupply = getTotalSupply(reserve);
  const mintAddress = reserve.liquidity.mintPubkey;
  const totalAmount = lamportsToNumberDecimal(totalSupply, decimals);
  const mintPrice = priceByMint[mintAddress.toString()] ?? 0;
  const totalValue = totalAmount.mul(mintPrice);
  const rewardPerTimeUnitSecond = getRewardPerTimeUnitSecond(rewardInfo);
  const rewardsInYear = rewardPerTimeUnitSecond.mul(60 * 60 * 24 * 365);
  const rewardTokenPrice = priceByMint[rewardInfo.token.mint.toString()] ?? 0;
  const rewardsInYearValue = rewardsInYear.mul(rewardTokenPrice);
  const apr = rewardsInYearValue.div(totalValue);
  return { apr, apy: aprToApy(apr, 1) };
}

function aprToApy(apr: Decimal, compoundPeriods: number) {
  // if periods = 365 => daily compound
  // periods = 1 => yearly compound
  // (1 + apr / periods) ** periods - 1;
  return new Decimal(1)
    .add(apr.div(compoundPeriods))
    .pow(compoundPeriods)
    .sub(1);
}

function lamportsToNumberDecimal(
  amount: Decimal.Value,
  decimals: number
): Decimal {
  const factor = 10 ** decimals;
  return new Decimal(amount).div(factor);
}
