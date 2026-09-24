import BigNumber from "bignumber.js";

import { nativeToUi } from "../../../utils/conversion.utils";
import { AssetTag, BankType } from "../types";

import { DriftSpotMarket, getDriftTokenAmount, SpotBalanceType } from "~/vendor/drift";
import { JUP_EXCHANGE_PRICES_PRECISION, JupTokenReserve } from "~/vendor/jup-lend";
import { KaminoReserve } from "~/vendor/klend";

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
      // `reserve.liquidity.totalAvailableAmount` is the actual liquid vault balance and therefore
      // the real cap on withdrawals.
      return new BigNumber(
        nativeToUi(reserveState.liquidity.totalAvailableAmount, decimals)
      ).times(VENUE_AVAILABLE_LIQUIDITY_BUFFER);
    }
    case AssetTag.DRIFT: {
      const spotMarketState = venueStates?.driftStates?.spotMarketState;
      if (!spotMarketState) return undefined;
      const deposits = getDriftTokenAmount(
        spotMarketState.depositBalance,
        spotMarketState,
        SpotBalanceType.Deposit
      );
      const borrows = getDriftTokenAmount(
        spotMarketState.borrowBalance,
        spotMarketState,
        SpotBalanceType.Borrow
      );
      const idle = deposits - borrows;
      return new BigNumber(nativeToUi(idle < 0n ? 0n : idle, decimals)).times(
        VENUE_AVAILABLE_LIQUIDITY_BUFFER
      );
    }
    case AssetTag.JUPLEND: {
      const reserveState = venueStates?.jupLendStates?.jupTokenReserveState;
      if (!reserveState) return undefined;
      // The `WithInterest` buckets are denominated in internal share units and must be multiplied
      // by the respective exchange price to get the underlying token amount. The `InterestFree`
      // buckets are already in native token units.
      const supplyWithInterestNative =
        (reserveState.totalSupplyWithInterest * reserveState.supplyExchangePrice) /
        JUP_EXCHANGE_PRICES_PRECISION;
      const borrowWithInterestNative =
        (reserveState.totalBorrowWithInterest * reserveState.borrowExchangePrice) /
        JUP_EXCHANGE_PRICES_PRECISION;
      const totalSupply = supplyWithInterestNative + reserveState.totalSupplyInterestFree;
      const totalBorrow = borrowWithInterestNative + reserveState.totalBorrowInterestFree;
      const idle = totalSupply - totalBorrow;
      return new BigNumber(nativeToUi(idle < 0n ? 0n : idle, decimals)).times(
        VENUE_AVAILABLE_LIQUIDITY_BUFFER
      );
    }
    default:
      return undefined;
  }
}
