import BN from "bn.js";
import {
  KaminoReserve,
  KaminoReserveDto,
  ObligationCollateralFields,
  ObligationCollateralJSON,
  ObligationJSON,
  ObligationLiquidityFields,
  ObligationLiquidityJSON,
  ObligationOrderFields,
  ObligationOrderJSON,
  ObligationRaw,
  ReserveRaw,
} from "../../types";
import { PublicKey } from "@solana/web3.js";
import { BorshCoder, Idl } from "@coral-xyz/anchor";
import { KLEND_IDL } from "../../idl";
import * as borsh from "@coral-xyz/borsh";

export const KLEND_ACCOUNT_CODER = new BorshCoder(KLEND_IDL);

const reserveDiscriminator = Buffer.from([43, 242, 204, 202, 26, 247, 59, 127]);

const obligationDiscriminator = Buffer.from([168, 206, 141, 106, 88, 76, 172, 167]);

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
        [borsh.array(borsh.u64(), 4, "value"), borsh.array(borsh.u64(), 2, "padding")],
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
        [borsh.array(borsh.u64(), 4, "value"), borsh.array(borsh.u64(), 2, "padding")],
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
            borsh.struct([borsh.u32("utilizationRateBps"), borsh.u32("borrowRateBps")]),
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
          borsh.struct([borsh.u64("lower"), borsh.u64("upper"), borsh.u64("exp")], "heuristic"),
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
            [borsh.publicKey("priceAggregator"), borsh.publicKey("twapAggregator")],
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
      borsh.array(borsh.u64(), 32, "borrowLimitAgainstThisCollateralInElevationGroup"),
      borsh.u64("deleveragingBonusIncreaseBpsPerDay"),
    ],
    "config"
  ),
  borsh.array(borsh.u64(), 116, "configPadding"),
  borsh.u64("borrowedAmountOutsideElevationGroup"),
  borsh.array(borsh.u64(), 32, "borrowedAmountsAgainstThisReserveInElevationGroups"),
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

export function dtoToObligationRaw(obligationDto: ObligationJSON): ObligationRaw {
  return {
    tag: new BN(obligationDto.tag),
    lastUpdate: {
      slot: new BN(obligationDto.lastUpdate.slot),
      stale: obligationDto.lastUpdate.stale,
      priceStatus: obligationDto.lastUpdate.priceStatus,
      placeholder: obligationDto.lastUpdate.placeholder,
    },
    lendingMarket: new PublicKey(obligationDto.lendingMarket),
    owner: new PublicKey(obligationDto.owner),
    deposits: obligationDto.deposits.map((item) => dtoToObligationCollateralFields(item)),
    lowestReserveDepositLiquidationLtv: new BN(obligationDto.lowestReserveDepositLiquidationLtv),
    depositedValueSf: new BN(obligationDto.depositedValueSf),
    borrows: obligationDto.borrows.map((item) => dtoToObligationLiquidityFields(item)),
    borrowFactorAdjustedDebtValueSf: new BN(obligationDto.borrowFactorAdjustedDebtValueSf),
    borrowedAssetsMarketValueSf: new BN(obligationDto.borrowedAssetsMarketValueSf),
    allowedBorrowValueSf: new BN(obligationDto.allowedBorrowValueSf),
    unhealthyBorrowValueSf: new BN(obligationDto.unhealthyBorrowValueSf),
    depositsAssetTiers: obligationDto.depositsAssetTiers,
    borrowsAssetTiers: obligationDto.borrowsAssetTiers,
    elevationGroup: obligationDto.elevationGroup,
    numOfObsoleteDepositReserves: obligationDto.numOfObsoleteDepositReserves,
    hasDebt: obligationDto.hasDebt,
    referrer: new PublicKey(obligationDto.referrer),
    borrowingDisabled: obligationDto.borrowingDisabled,
    autodeleverageTargetLtvPct: obligationDto.autodeleverageTargetLtvPct,
    lowestReserveDepositMaxLtvPct: obligationDto.lowestReserveDepositMaxLtvPct,
    numOfObsoleteBorrowReserves: obligationDto.numOfObsoleteBorrowReserves,
    reserved: obligationDto.reserved,
    highestBorrowFactorPct: new BN(obligationDto.highestBorrowFactorPct),
    autodeleverageMarginCallStartedTimestamp: new BN(
      obligationDto.autodeleverageMarginCallStartedTimestamp
    ),
    orders: obligationDto.orders.map((item) => dtoToObligationOrderFields(item)),
    padding3: obligationDto.padding3.map((item) => new BN(item)),
  };
}

function dtoToObligationCollateralFields(
  obligationCollateralDto: ObligationCollateralJSON
): ObligationCollateralFields {
  return {
    depositReserve: new PublicKey(obligationCollateralDto.depositReserve),
    depositedAmount: new BN(obligationCollateralDto.depositedAmount),
    marketValueSf: new BN(obligationCollateralDto.marketValueSf),
    borrowedAmountAgainstThisCollateralInElevationGroup: new BN(
      obligationCollateralDto.borrowedAmountAgainstThisCollateralInElevationGroup
    ),
    padding: obligationCollateralDto.padding.map((item) => new BN(item)),
  };
}

function dtoToObligationLiquidityFields(
  obligationLiquidityDto: ObligationLiquidityJSON
): ObligationLiquidityFields {
  return {
    borrowReserve: new PublicKey(obligationLiquidityDto.borrowReserve),
    cumulativeBorrowRateBsf: {
      value: obligationLiquidityDto.cumulativeBorrowRateBsf.value.map((item) => new BN(item)),
      padding: obligationLiquidityDto.cumulativeBorrowRateBsf.padding.map((item) => new BN(item)),
    },
    padding: new BN(obligationLiquidityDto.padding),
    borrowedAmountSf: new BN(obligationLiquidityDto.borrowedAmountSf),
    marketValueSf: new BN(obligationLiquidityDto.marketValueSf),
    borrowFactorAdjustedMarketValueSf: new BN(
      obligationLiquidityDto.borrowFactorAdjustedMarketValueSf
    ),
    borrowedAmountOutsideElevationGroups: new BN(
      obligationLiquidityDto.borrowedAmountOutsideElevationGroups
    ),
    padding2: obligationLiquidityDto.padding2.map((item) => new BN(item)),
  };
}

function dtoToObligationOrderFields(
  obligationOrderDto: ObligationOrderJSON
): ObligationOrderFields {
  return {
    conditionThresholdSf: new BN(obligationOrderDto.conditionThresholdSf),
    opportunityParameterSf: new BN(obligationOrderDto.opportunityParameterSf),
    minExecutionBonusBps: obligationOrderDto.minExecutionBonusBps,
    maxExecutionBonusBps: obligationOrderDto.maxExecutionBonusBps,
    conditionType: obligationOrderDto.conditionType,
    opportunityType: obligationOrderDto.opportunityType,
    padding1: obligationOrderDto.padding1,
    padding2: obligationOrderDto.padding2.map((item) => new BN(item)),
  };
}

export function dtoToKaminoReserve(dto: KaminoReserveDto): KaminoReserve {
  return {
    lendingMarket: new PublicKey(dto.lendingMarket),
    farmCollateral: new PublicKey(dto.farmCollateral),
    liquidity: {
      mintPubkey: new PublicKey(dto.liquidity.mintPubkey),
      mintDecimals: new BN(dto.liquidity.mintDecimals),
      availableAmount: new BN(dto.liquidity.availableAmount),
      borrowedAmountSf: new BN(dto.liquidity.borrowedAmountSf),
      accumulatedProtocolFeesSf: new BN(dto.liquidity.accumulatedProtocolFeesSf),
      accumulatedReferrerFeesSf: new BN(dto.liquidity.accumulatedReferrerFeesSf),
      pendingReferrerFeesSf: new BN(dto.liquidity.pendingReferrerFeesSf),
      supplyVault: new PublicKey(dto.liquidity.supplyVault),
    },
    collateral: {
      mintPubkey: new PublicKey(dto.collateral.mintPubkey),
      mintTotalSupply: new BN(dto.collateral.mintTotalSupply),
      supplyVault: new PublicKey(dto.collateral.supplyVault),
    },
    config: {
      hostFixedInterestRateBps: dto.config.hostFixedInterestRateBps,
      protocolTakeRatePct: dto.config.protocolTakeRatePct,
      borrowRateCurve: {
        points: dto.config.borrowRateCurve.points.map((p) => ({
          utilizationRateBps: p.utilizationRateBps,
          borrowRateBps: p.borrowRateBps,
        })),
      },
      depositLimit: new BN(dto.config.depositLimit),
      borrowLimit: new BN(dto.config.borrowLimit),
      tokenInfo: {
        pythConfiguration: {
          price: new PublicKey(dto.config.tokenInfo.pythConfiguration.price),
        },
        switchboardConfiguration: {
          priceAggregator: new PublicKey(
            dto.config.tokenInfo.switchboardConfiguration.priceAggregator
          ),
          twapAggregator: new PublicKey(
            dto.config.tokenInfo.switchboardConfiguration.twapAggregator
          ),
        },
        scopeConfiguration: {
          priceFeed: new PublicKey(dto.config.tokenInfo.scopeConfiguration.priceFeed),
        },
      },
    },
  };
}
