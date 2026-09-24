import { address, getAddressDecoder, getBase64Encoder } from "@solana/kit";
import { describe, expect, it } from "vitest";

import banks from "./fixtures/mainnet-banks.json";

import { decodeBank } from "~/accounts";
import { parseBankRaw } from "~/services/bank/utils/deserialize.utils";
import {
  computeVenueAvailableLiquidity,
  VENUE_AVAILABLE_LIQUIDITY_BUFFER,
} from "~/services/bank/utils/venue-liquidity.utils";
import { KaminoInterestRateBasis, KaminoReserve } from "~/vendor/klend";

const pk = (seed: number) => getAddressDecoder().decode(new Uint8Array(32).fill(seed));

const kaminoFixture = banks.find((bank) => bank.label === "kamino");
if (!kaminoFixture) throw new Error("missing kamino bank fixture");
const kaminoBank = parseBankRaw(
  address(kaminoFixture.address),
  decodeBank(getBase64Encoder().encode(kaminoFixture.data))
);
const unit = 10 ** kaminoBank.mintDecimals;

// 1000 tokens idle + 3000 borrowed over 2000 cTokens: 2 tokens per cToken.
const makeReserve = (queuedCollateralAmount: bigint): KaminoReserve => ({
  lendingMarket: pk(1),
  farmCollateral: pk(2),
  liquidity: {
    mintPubkey: pk(3),
    supplyVault: pk(4),
    mintDecimals: BigInt(kaminoBank.mintDecimals),
    totalAvailableAmount: BigInt(1000 * unit),
    borrowedAmountSf: BigInt(3000 * unit) << 60n,
    accumulatedProtocolFeesSf: 0n,
    accumulatedReferrerFeesSf: 0n,
    pendingReferrerFeesSf: 0n,
  },
  collateral: { mintPubkey: pk(5), mintTotalSupply: BigInt(2000 * unit), supplyVault: pk(6) },
  withdrawQueue: { queuedCollateralAmount },
  config: {
    protocolTakeRatePct: 0,
    hostFixedInterestRateBps: 0,
    interestRateBasis: KaminoInterestRateBasis.TrueApr,
    depositLimit: 0n,
    borrowLimit: 0n,
    borrowRateCurve: { points: [] },
    tokenInfo: {
      scopeConfiguration: { priceFeed: pk(7) },
      switchboardConfiguration: { priceAggregator: pk(8), twapAggregator: pk(9) },
      pythConfiguration: { price: pk(10) },
    },
  },
});

const venueLiquidity = (queuedCollateralAmount: bigint) =>
  computeVenueAvailableLiquidity(kaminoBank, {
    kaminoStates: { reserveState: makeReserve(queuedCollateralAmount) },
  })?.toNumber();

describe("computeVenueAvailableLiquidity (Kamino)", () => {
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
});
