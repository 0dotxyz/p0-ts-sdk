import { BigNumber } from "bignumber.js";
import { describe, expect, it } from "vitest";

import { key } from "../../../helpers/addresses";
import { makeBank } from "../../../helpers/factories";
import { mainnetBanks } from "../../../helpers/mainnet";

import { AssetTag } from "~/services/bank/types";
import {
  BankVenueStates,
  computeVenueAvailableLiquidity,
  VENUE_AVAILABLE_LIQUIDITY_BUFFER,
} from "~/services/bank/utils/venue-liquidity.utils";
import { KaminoInterestRateBasis, KaminoReserve } from "~/vendor/klend";

const kaminoBank = mainnetBanks.kamino;
const unit = 10 ** kaminoBank.mintDecimals;

// 1000 tokens idle + 3000 borrowed over 2000 cTokens: 2 tokens per cToken.
const makeReserve = (queuedCollateralAmount: bigint): KaminoReserve => ({
  lendingMarket: key(1),
  farmCollateral: key(2),
  liquidity: {
    mintPubkey: key(3),
    supplyVault: key(4),
    mintDecimals: BigInt(kaminoBank.mintDecimals),
    totalAvailableAmount: BigInt(1000 * unit),
    borrowedAmountSf: BigInt(3000 * unit) << 60n,
    accumulatedProtocolFeesSf: 0n,
    accumulatedReferrerFeesSf: 0n,
    pendingReferrerFeesSf: 0n,
  },
  collateral: { mintPubkey: key(5), mintTotalSupply: BigInt(2000 * unit), supplyVault: key(6) },
  withdrawQueue: { queuedCollateralAmount },
  config: {
    protocolTakeRatePct: 0,
    hostFixedInterestRateBps: 0,
    emergencyMode: 0,
    interestRateBasis: KaminoInterestRateBasis.TrueApr,
    depositLimit: 0n,
    borrowLimit: 0n,
    borrowRateCurve: { points: [] },
    tokenInfo: {
      scopeConfiguration: { priceFeed: key(7) },
      switchboardConfiguration: { priceAggregator: key(8), twapAggregator: key(9) },
      pythConfiguration: { price: key(10) },
    },
  },
});

const venueLiquidity = (queuedCollateralAmount: bigint) =>
  computeVenueAvailableLiquidity(kaminoBank, {
    kaminoStates: { reserveState: makeReserve(queuedCollateralAmount) },
  })?.toNumber();

const DECIMALS = 6;
const ui = (n: number) => new BigNumber(n).times(10 ** DECIMALS);

describe("computeVenueAvailableLiquidity", () => {
  it("uses the whole vault balance when nothing is queued", () => {
    expect(venueLiquidity(0n)).toBeCloseTo(1000 * VENUE_AVAILABLE_LIQUIDITY_BUFFER);
  });

  it("excludes liquidity reserved for the withdraw queue", () => {
    // 100 queued cTokens = 200 tokens reserved for ticket holders
    expect(venueLiquidity(BigInt(100 * unit))).toBeCloseTo(800 * VENUE_AVAILABLE_LIQUIDITY_BUFFER);
  });

  it("is zero when the queue exceeds the vault balance", () => {
    expect(venueLiquidity(BigInt(600 * unit))).toBe(0);
  });

  it("derives Drift idle liquidity from scaled balances", () => {
    const b = makeBank({ mintDecimals: DECIMALS, config: { assetTag: AssetTag.DRIFT } });
    // 1e9-precision balances with 1.0 cumulative interest (1e10 precision):
    // deposits 500, borrows 200 -> idle 300 (before buffer)
    const spotMarketState = {
      decimals: DECIMALS,
      depositBalance: 500n * 10n ** 9n,
      borrowBalance: 200n * 10n ** 9n,
      cumulativeDepositInterest: 10n ** 10n,
      cumulativeBorrowInterest: 10n ** 10n,
    } as unknown as NonNullable<BankVenueStates["driftStates"]>["spotMarketState"];
    const liq = computeVenueAvailableLiquidity(b, { driftStates: { spotMarketState } });
    expect(liq?.toNumber()).toBeCloseTo(300 * VENUE_AVAILABLE_LIQUIDITY_BUFFER, 6);
  });

  it("derives JupLend idle liquidity from exchange-price buckets", () => {
    const b = makeBank({ mintDecimals: DECIMALS, config: { assetTag: AssetTag.JUPLEND } });
    const px = 1_000_000_000_000n; // 1.0 at 1e12 precision
    const tokenReserveState = {
      totalSupplyWithInterest: BigInt(ui(400).toFixed(0)),
      totalBorrowWithInterest: BigInt(ui(150).toFixed(0)),
      totalSupplyInterestFree: BigInt(ui(50).toFixed(0)),
      totalBorrowInterestFree: 0n,
      supplyExchangePrice: px,
      borrowExchangePrice: px,
    } as unknown as NonNullable<BankVenueStates["jupLendStates"]>["tokenReserveState"];
    const liq = computeVenueAvailableLiquidity(b, { jupLendStates: { tokenReserveState } });
    // (400 + 50) - 150 = 300
    expect(liq?.toNumber()).toBeCloseTo(300 * VENUE_AVAILABLE_LIQUIDITY_BUFFER, 6);
  });

  it("clamps negative idle to 0 and returns undefined without a venue", () => {
    const b = makeBank({ config: { assetTag: AssetTag.KAMINO } });
    expect(computeVenueAvailableLiquidity(b, {})).toBeUndefined();
    const defaultBank = makeBank();
    expect(computeVenueAvailableLiquidity(defaultBank, {})).toBeUndefined();
  });
});
