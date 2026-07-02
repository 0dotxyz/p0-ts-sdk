import {
  KaminoObligation,
  KaminoObligationJSON,
  KaminoReserve,
  KaminoReserveJSON,
} from "../../types";

/**
 * Serialize a Kamino Obligation to its JSON DTO.
 *
 * The parameter is typed as the curated {@link KaminoObligation}, so a
 * freshly decoded `ObligationRaw` is accepted structurally and trimmed
 * down to the curated shape here.
 */
export function kaminoObligationToDto(
  obligation: KaminoObligation
): KaminoObligationJSON {
  return {
    lendingMarket: obligation.lendingMarket.toBase58(),
    owner: obligation.owner.toBase58(),
    deposits: obligation.deposits.map((item) => ({
      depositReserve: item.depositReserve.toBase58(),
      depositedAmount: item.depositedAmount.toString(),
      marketValueSf: item.marketValueSf.toString(),
    })),
    borrows: obligation.borrows.map((item) => ({
      borrowReserve: item.borrowReserve.toBase58(),
      borrowedAmountSf: item.borrowedAmountSf.toString(),
      marketValueSf: item.marketValueSf.toString(),
    })),
  };
}

/**
 * Serialize a Kamino Reserve to its JSON DTO.
 *
 * The parameter is typed as the curated {@link KaminoReserve}, so a
 * freshly decoded `ReserveRaw` is accepted structurally and trimmed
 * down to the curated shape here.
 */
export function kaminoReserveToDto(reserve: KaminoReserve): KaminoReserveJSON {
  return {
    lendingMarket: reserve.lendingMarket.toBase58(),
    farmCollateral: reserve.farmCollateral.toBase58(),
    liquidity: {
      mintPubkey: reserve.liquidity.mintPubkey.toBase58(),
      supplyVault: reserve.liquidity.supplyVault.toBase58(),
      mintDecimals: reserve.liquidity.mintDecimals.toString(),
      availableAmount: reserve.liquidity.availableAmount.toString(),
      borrowedAmountSf: reserve.liquidity.borrowedAmountSf.toString(),
      accumulatedProtocolFeesSf:
        reserve.liquidity.accumulatedProtocolFeesSf.toString(),
      accumulatedReferrerFeesSf:
        reserve.liquidity.accumulatedReferrerFeesSf.toString(),
      pendingReferrerFeesSf: reserve.liquidity.pendingReferrerFeesSf.toString(),
    },
    collateral: {
      mintPubkey: reserve.collateral.mintPubkey.toBase58(),
      mintTotalSupply: reserve.collateral.mintTotalSupply.toString(),
      supplyVault: reserve.collateral.supplyVault.toBase58(),
    },
    config: {
      protocolTakeRatePct: reserve.config.protocolTakeRatePct,
      hostFixedInterestRateBps: reserve.config.hostFixedInterestRateBps,
      depositLimit: reserve.config.depositLimit.toString(),
      borrowLimit: reserve.config.borrowLimit.toString(),
      borrowRateCurve: {
        points: reserve.config.borrowRateCurve.points.map((item) => ({
          utilizationRateBps: item.utilizationRateBps,
          borrowRateBps: item.borrowRateBps,
        })),
      },
      tokenInfo: {
        scopeConfiguration: {
          priceFeed:
            reserve.config.tokenInfo.scopeConfiguration.priceFeed.toBase58(),
        },
        switchboardConfiguration: {
          priceAggregator:
            reserve.config.tokenInfo.switchboardConfiguration.priceAggregator.toBase58(),
          twapAggregator:
            reserve.config.tokenInfo.switchboardConfiguration.twapAggregator.toBase58(),
        },
        pythConfiguration: {
          price: reserve.config.tokenInfo.pythConfiguration.price.toBase58(),
        },
      },
    },
  };
}
