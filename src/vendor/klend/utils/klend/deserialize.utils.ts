import BN from "bn.js";
import {
  KaminoObligation,
  KaminoObligationJSON,
  KaminoReserve,
  KaminoReserveJSON,
  ObligationRaw,
  ReserveRaw,
} from "../../types";
import { PublicKey } from "@solana/web3.js";
import { BorshCoder, Idl } from "@coral-xyz/anchor";
import { KLEND_IDL } from "../../idl";
import * as borsh from "@coral-xyz/borsh";

export const KLEND_ACCOUNT_CODER = new BorshCoder(KLEND_IDL);

const reserveDiscriminator = Buffer.from([43, 242, 204, 202, 26, 247, 59, 127]);

const obligationDiscriminator = Buffer.from([
  168, 206, 141, 106, 88, 76, 172, 167,
]);

const obligationLayout = borsh.struct<ObligationRaw>([
  borsh.u64("tag"),
  borsh.struct(
    [
      borsh.u64("slot"),
      borsh.u8("stale"),
      borsh.u8("priceStatus"),
      borsh.array(borsh.u8(), 6, "placeholder"),
    ],
    "lastUpdate"
  ),
  borsh.publicKey("lendingMarket"),
  borsh.publicKey("owner"),
  borsh.array(
    borsh.struct([
      borsh.publicKey("depositReserve"),
      borsh.u64("depositedAmount"),
      borsh.u128("marketValueSf"),
      borsh.u64("borrowedAmountAgainstThisCollateralInElevationGroup"),
      borsh.array(borsh.u64(), 9, "padding"),
    ]),
    8,
    "deposits"
  ),
  borsh.u64("lowestReserveDepositLiquidationLtv"),
  borsh.u128("depositedValueSf"),
  borsh.array(
    borsh.struct([
      borsh.publicKey("borrowReserve"),
      borsh.struct(
        [
          borsh.array(borsh.u64(), 4, "value"),
          borsh.array(borsh.u64(), 2, "padding"),
        ],
        "cumulativeBorrowRateBsf"
      ),
      borsh.u64("padding"),
      borsh.u128("borrowedAmountSf"),
      borsh.u128("marketValueSf"),
      borsh.u128("borrowFactorAdjustedMarketValueSf"),
      borsh.u64("borrowedAmountOutsideElevationGroups"),
      borsh.array(borsh.u64(), 7, "padding2"),
    ]),
    5,
    "borrows"
  ),
  borsh.u128("borrowFactorAdjustedDebtValueSf"),
  borsh.u128("borrowedAssetsMarketValueSf"),
  borsh.u128("allowedBorrowValueSf"),
  borsh.u128("unhealthyBorrowValueSf"),
  borsh.array(borsh.u8(), 8, "depositsAssetTiers"),
  borsh.array(borsh.u8(), 5, "borrowsAssetTiers"),
  borsh.u8("elevationGroup"),
  borsh.u8("numOfObsoleteDepositReserves"),
  borsh.u8("hasDebt"),
  borsh.publicKey("referrer"),
  borsh.u8("borrowingDisabled"),
  borsh.u8("autodeleverageTargetLtvPct"),
  borsh.u8("lowestReserveDepositMaxLtvPct"),
  borsh.u8("numOfObsoleteBorrowReserves"),
  borsh.array(borsh.u8(), 4, "reserved"),
  borsh.u64("highestBorrowFactorPct"),
  borsh.u64("autodeleverageMarginCallStartedTimestamp"),
  borsh.array(
    borsh.struct([
      borsh.u128("conditionThresholdSf"),
      borsh.u128("opportunityParameterSf"),
      borsh.u16("minExecutionBonusBps"),
      borsh.u16("maxExecutionBonusBps"),
      borsh.u8("conditionType"),
      borsh.u8("opportunityType"),
      borsh.array(borsh.u8(), 10, "padding1"),
      borsh.array(borsh.u128(), 5, "padding2"),
    ]),
    2,
    "orders"
  ),
  borsh.array(borsh.u64(), 93, "padding3"),
]);

const reserveLayout = borsh.struct<ReserveRaw>([
  borsh.u64("version"),
  borsh.struct(
    [
      borsh.u64("slot"),
      borsh.u8("stale"),
      borsh.u8("priceStatus"),
      borsh.array(borsh.u8(), 6, "placeholder"),
    ],
    "lastUpdate"
  ),
  borsh.publicKey("lendingMarket"),
  borsh.publicKey("farmCollateral"),
  borsh.publicKey("farmDebt"),
  borsh.struct(
    [
      borsh.publicKey("mintPubkey"),
      borsh.publicKey("supplyVault"),
      borsh.publicKey("feeVault"),
      borsh.u64("availableAmount"),
      borsh.u128("borrowedAmountSf"),
      borsh.u128("marketPriceSf"),
      borsh.u64("marketPriceLastUpdatedTs"),
      borsh.u64("mintDecimals"),
      borsh.u64("depositLimitCrossedTimestamp"),
      borsh.u64("borrowLimitCrossedTimestamp"),
      borsh.struct(
        [
          borsh.array(borsh.u64(), 4, "value"),
          borsh.array(borsh.u64(), 2, "padding"),
        ],
        "cumulativeBorrowRateBsf"
      ),
      borsh.u128("accumulatedProtocolFeesSf"),
      borsh.u128("accumulatedReferrerFeesSf"),
      borsh.u128("pendingReferrerFeesSf"),
      borsh.u128("absoluteReferralRateSf"),
      borsh.publicKey("tokenProgram"),
      borsh.array(borsh.u64(), 51, "padding2"),
      borsh.array(borsh.u128(), 32, "padding3"),
    ],
    "liquidity"
  ),
  borsh.array(borsh.u64(), 150, "reserveLiquidityPadding"),
  borsh.struct(
    [
      borsh.publicKey("mintPubkey"),
      borsh.u64("mintTotalSupply"),
      borsh.publicKey("supplyVault"),
      borsh.array(borsh.u128(), 32, "padding1"),
      borsh.array(borsh.u128(), 32, "padding2"),
    ],
    "collateral"
  ),
  borsh.array(borsh.u64(), 150, "reserveCollateralPadding"),
  borsh.struct(
    [
      borsh.u8("status"),
      borsh.u8("assetTier"),
      borsh.u16("hostFixedInterestRateBps"),
      borsh.array(borsh.u8(), 9, "reserved2"),
      borsh.u8("protocolOrderExecutionFeePct"),
      borsh.u8("protocolTakeRatePct"),
      borsh.u8("protocolLiquidationFeePct"),
      borsh.u8("loanToValuePct"),
      borsh.u8("liquidationThresholdPct"),
      borsh.u16("minLiquidationBonusBps"),
      borsh.u16("maxLiquidationBonusBps"),
      borsh.u16("badDebtLiquidationBonusBps"),
      borsh.u64("deleveragingMarginCallPeriodSecs"),
      borsh.u64("deleveragingThresholdDecreaseBpsPerDay"),
      borsh.struct(
        [
          borsh.u64("borrowFeeSf"),
          borsh.u64("flashLoanFeeSf"),
          borsh.array(borsh.u8(), 8, "padding"),
        ],
        "fees"
      ),
      borsh.struct(
        [
          borsh.array(
            borsh.struct([
              borsh.u32("utilizationRateBps"),
              borsh.u32("borrowRateBps"),
            ]),
            11,
            "points"
          ),
        ],
        "borrowRateCurve"
      ),
      borsh.u64("borrowFactorPct"),
      borsh.u64("depositLimit"),
      borsh.u64("borrowLimit"),
      borsh.struct(
        [
          borsh.array(borsh.u8(), 32, "name"),
          borsh.struct(
            [borsh.u64("lower"), borsh.u64("upper"), borsh.u64("exp")],
            "heuristic"
          ),
          borsh.u64("maxTwapDivergenceBps"),
          borsh.u64("maxAgePriceSeconds"),
          borsh.u64("maxAgeTwapSeconds"),
          borsh.struct(
            [
              borsh.publicKey("priceFeed"),
              borsh.array(borsh.u16(), 4, "priceChain"),
              borsh.array(borsh.u16(), 4, "twapChain"),
            ],
            "scopeConfiguration"
          ),
          borsh.struct(
            [
              borsh.publicKey("priceAggregator"),
              borsh.publicKey("twapAggregator"),
            ],
            "switchboardConfiguration"
          ),
          borsh.struct([borsh.publicKey("price")], "pythConfiguration"),
          borsh.u8("blockPriceUsage"),
          borsh.array(borsh.u8(), 7, "reserved"),
          borsh.array(borsh.u64(), 19, "padding"),
        ],
        "tokenInfo"
      ),
      borsh.struct(
        [
          borsh.i64("configCapacity"),
          borsh.i64("currentTotal"),
          borsh.u64("lastIntervalStartTimestamp"),
          borsh.u64("configIntervalLengthSeconds"),
        ],
        "depositWithdrawalCap"
      ),
      borsh.struct(
        [
          borsh.i64("configCapacity"),
          borsh.i64("currentTotal"),
          borsh.u64("lastIntervalStartTimestamp"),
          borsh.u64("configIntervalLengthSeconds"),
        ],
        "debtWithdrawalCap"
      ),
      borsh.array(borsh.u8(), 20, "elevationGroups"),
      borsh.u8("disableUsageAsCollOutsideEmode"),
      borsh.u8("utilizationLimitBlockBorrowingAbovePct"),
      borsh.u8("autodeleverageEnabled"),
      borsh.array(borsh.u8(), 1, "reserved1"),
      borsh.u64("borrowLimitOutsideElevationGroup"),
      borsh.array(
        borsh.u64(),
        32,
        "borrowLimitAgainstThisCollateralInElevationGroup"
      ),
      borsh.u64("deleveragingBonusIncreaseBpsPerDay"),
    ],
    "config"
  ),
  borsh.array(borsh.u64(), 116, "configPadding"),
  borsh.u64("borrowedAmountOutsideElevationGroup"),
  borsh.array(
    borsh.u64(),
    32,
    "borrowedAmountsAgainstThisReserveInElevationGroups"
  ),
  borsh.array(borsh.u64(), 207, "padding"),
]);

export function decodeKlendReserveData(data: Buffer): ReserveRaw {
  if (!data.slice(0, 8).equals(reserveDiscriminator)) {
    throw new Error("invalid account discriminator");
  }

  const dec = reserveLayout.decode(data.slice(8));
  return dec;
}

export function decodeKlendObligationData(data: Buffer): ObligationRaw {
  if (!data.slice(0, 8).equals(obligationDiscriminator)) {
    throw new Error("invalid account discriminator");
  }

  const dec = obligationLayout.decode(data.slice(8));
  return dec;
}

export function dtoToKaminoObligation(
  obligationDto: KaminoObligationJSON
): KaminoObligation {
  return {
    lendingMarket: new PublicKey(obligationDto.lendingMarket),
    owner: new PublicKey(obligationDto.owner),
    // Hosted endpoints may prune empty position arrays from the payload
    deposits: (obligationDto.deposits ?? []).map((item) => ({
      depositReserve: new PublicKey(item.depositReserve),
      depositedAmount: new BN(item.depositedAmount),
      marketValueSf: new BN(item.marketValueSf),
    })),
    borrows: (obligationDto.borrows ?? []).map((item) => ({
      borrowReserve: new PublicKey(item.borrowReserve),
      borrowedAmountSf: new BN(item.borrowedAmountSf),
      marketValueSf: new BN(item.marketValueSf),
    })),
  };
}

export function dtoToKaminoReserve(reserveDto: KaminoReserveJSON): KaminoReserve {
  return {
    lendingMarket: new PublicKey(reserveDto.lendingMarket),
    farmCollateral: new PublicKey(reserveDto.farmCollateral),
    liquidity: {
      mintPubkey: new PublicKey(reserveDto.liquidity.mintPubkey),
      supplyVault: new PublicKey(reserveDto.liquidity.supplyVault),
      mintDecimals: new BN(reserveDto.liquidity.mintDecimals),
      availableAmount: new BN(reserveDto.liquidity.availableAmount),
      borrowedAmountSf: new BN(reserveDto.liquidity.borrowedAmountSf),
      accumulatedProtocolFeesSf: new BN(
        reserveDto.liquidity.accumulatedProtocolFeesSf
      ),
      accumulatedReferrerFeesSf: new BN(
        reserveDto.liquidity.accumulatedReferrerFeesSf
      ),
      pendingReferrerFeesSf: new BN(reserveDto.liquidity.pendingReferrerFeesSf),
    },
    collateral: {
      mintPubkey: new PublicKey(reserveDto.collateral.mintPubkey),
      mintTotalSupply: new BN(reserveDto.collateral.mintTotalSupply),
      supplyVault: new PublicKey(reserveDto.collateral.supplyVault),
    },
    config: {
      protocolTakeRatePct: reserveDto.config.protocolTakeRatePct,
      hostFixedInterestRateBps: reserveDto.config.hostFixedInterestRateBps,
      depositLimit: new BN(reserveDto.config.depositLimit),
      borrowLimit: new BN(reserveDto.config.borrowLimit),
      borrowRateCurve: {
        points: reserveDto.config.borrowRateCurve.points.map((item) => ({
          utilizationRateBps: item.utilizationRateBps,
          borrowRateBps: item.borrowRateBps,
        })),
      },
      tokenInfo: {
        scopeConfiguration: {
          priceFeed: new PublicKey(
            reserveDto.config.tokenInfo.scopeConfiguration.priceFeed
          ),
        },
        switchboardConfiguration: {
          priceAggregator: new PublicKey(
            reserveDto.config.tokenInfo.switchboardConfiguration.priceAggregator
          ),
          twapAggregator: new PublicKey(
            reserveDto.config.tokenInfo.switchboardConfiguration.twapAggregator
          ),
        },
        pythConfiguration: {
          price: new PublicKey(
            reserveDto.config.tokenInfo.pythConfiguration.price
          ),
        },
      },
    },
  };
}
