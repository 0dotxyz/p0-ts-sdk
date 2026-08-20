import BigNumber from "bignumber.js";

import { DriftSpotBalanceType, DriftSpotMarket, getDriftTokenAmount } from "~/vendor/drift";
import { KaminoReserve } from "~/vendor/klend";
import { JupTokenReserve } from "~/vendor/jup-lend";
import { JUP_EXCHANGE_PRICES_PRECISION } from "~/vendor/jup-lend/utils/interest-rate.utils";

import { AssetTag, BankType } from "../types";
import { nativeToUi } from "../../../utils/conversion.utils";

/**
 * The venue-side account states needed to derive an integrated bank's true liquidity.
 *
 * Structurally compatible with `BankIntegrationMetadata` (`client.bankIntegrationMap[address]`),
 * so that map's entries can be passed directly.
 */
export interface BankVenueStates {
  kaminoStates?: { reserveState: KaminoReserve };
  driftStates?: { spotMarketState: DriftSpotMarket };
  jupLendStates?: { jupTokenReserveState: JupTokenReserve };
}

/**
 * Safety buffer applied to venue idle liquidity. Venue reserve states are snapshots refreshed on
 * the caller's cadence, and unlike the marginfi bank we don't project the venue's own interest
 * accrual, so the effective withdrawable amount can drift slightly below what the cached state
 * reports. Shave ~50 bps to avoid simulation failures right at the reported cap.
 */
export const VENUE_AVAILABLE_LIQUIDITY_BUFFER = 0.995;

/**
 * Idle liquidity of the external venue backing an integrated bank (Kamino reserve, Drift spot
 * market, JupLend token reserve), in UI units of the underlying token, with
 * {@link VENUE_AVAILABLE_LIQUIDITY_BUFFER} applied.
 *
 * For integrated banks the marginfi-level totals only describe what marginfi has delegated to the
 * venue — the venue's own utilization is the true cap on withdrawals (a fully utilized Kamino
 * reserve pays out nothing even if marginfi's position is large). Returns `undefined` for banks
 * without an external venue (DEFAULT/SOL/STAKED) or when the relevant venue state is missing.
 */
export function computeVenueAvailableLiquidity(
  bank: BankType,
  venueStates?: BankVenueStates
): BigNumber | undefined {
  const decimals = bank.mintDecimals;

  switch (bank.config.assetTag) {
    case AssetTag.KAMINO: {
      const reserveState = venueStates?.kaminoStates?.reserveState;
      if (!reserveState) return undefined;
      // `reserve.liquidity.availableAmount` is the actual liquid vault balance and therefore the
      // real cap on withdrawals.
      return new BigNumber(
        nativeToUi(reserveState.liquidity.availableAmount.toString(), decimals)
      ).times(VENUE_AVAILABLE_LIQUIDITY_BUFFER);
    }
    case AssetTag.DRIFT: {
      const spotMarketState = venueStates?.driftStates?.spotMarketState;
      if (!spotMarketState) return undefined;
      const deposits = getDriftTokenAmount(
        spotMarketState.depositBalance,
        spotMarketState,
        DriftSpotBalanceType.DEPOSIT
      );
      const borrows = getDriftTokenAmount(
        spotMarketState.borrowBalance,
        spotMarketState,
        DriftSpotBalanceType.BORROW
      );
      const idle = deposits.sub(borrows);
      return new BigNumber(nativeToUi(idle.isNeg() ? "0" : idle.toString(), decimals)).times(
        VENUE_AVAILABLE_LIQUIDITY_BUFFER
      );
    }
    case AssetTag.JUPLEND: {
      const reserveState = venueStates?.jupLendStates?.jupTokenReserveState;
      if (!reserveState) return undefined;
      // The `WithInterest` buckets are denominated in internal share units and must be multiplied
      // by the respective exchange price to get the underlying token amount. The `InterestFree`
      // buckets are already in native token units.
      const supplyWithInterestNative = reserveState.totalSupplyWithInterest
        .mul(reserveState.supplyExchangePrice)
        .div(JUP_EXCHANGE_PRICES_PRECISION);
      const borrowWithInterestNative = reserveState.totalBorrowWithInterest
        .mul(reserveState.borrowExchangePrice)
        .div(JUP_EXCHANGE_PRICES_PRECISION);
      const totalSupply = supplyWithInterestNative.add(reserveState.totalSupplyInterestFree);
      const totalBorrow = borrowWithInterestNative.add(reserveState.totalBorrowInterestFree);
      const idle = totalSupply.sub(totalBorrow);
      return new BigNumber(nativeToUi(idle.isNeg() ? "0" : idle.toString(), decimals)).times(
        VENUE_AVAILABLE_LIQUIDITY_BUFFER
      );
    }
    default:
      return undefined;
  }
}
