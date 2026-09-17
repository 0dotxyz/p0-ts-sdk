import { AccountRole, address, getAddressDecoder } from "@solana/kit";
import { describe, expect, it } from "vitest";

import { KAMINO_LENDING_PROGRAM_ADDRESS } from "~/generated/klend";
import {
  KaminoInterestRateBasis,
  KaminoReserve,
  makeRefreshObligationIx,
  makeRefreshReserveIx,
  makeRefreshReservesBatchIx,
} from "~/vendor/klend";

const key = (fill: number) => getAddressDecoder().decode(new Uint8Array(32).fill(fill));

const reserve: KaminoReserve = {
  lendingMarket: key(1),
  farmCollateral: key(2),
  liquidity: {
    mintPubkey: key(3),
    supplyVault: key(4),
    mintDecimals: 6n,
    totalAvailableAmount: 0n,
    borrowedAmountSf: 0n,
    accumulatedProtocolFeesSf: 0n,
    accumulatedReferrerFeesSf: 0n,
    pendingReferrerFeesSf: 0n,
  },
  collateral: { mintPubkey: key(5), mintTotalSupply: 0n, supplyVault: key(6) },
  config: {
    protocolTakeRatePct: 0,
    hostFixedInterestRateBps: 0,
    interestRateBasis: KaminoInterestRateBasis.Legacy,
    depositLimit: 0n,
    borrowLimit: 0n,
    borrowRateCurve: { points: [] },
    tokenInfo: {
      scopeConfiguration: { priceFeed: address("11111111111111111111111111111111") },
      switchboardConfiguration: {
        priceAggregator: address("nu11111111111111111111111111111111111111111"),
        twapAggregator: address("11111111111111111111111111111111"),
      },
      pythConfiguration: { price: key(7) },
    },
  },
};

describe("klend refresh instructions", () => {
  it("refreshes a reserve with disabled oracles as program-id placeholders", () => {
    const ix = makeRefreshReserveIx(key(9), reserve);

    expect(ix.programAddress).toBe(KAMINO_LENDING_PROGRAM_ADDRESS);
    expect(ix.accounts).toEqual([
      { address: key(9), role: AccountRole.WRITABLE },
      { address: key(1), role: AccountRole.READONLY },
      { address: key(7), role: AccountRole.READONLY },
      { address: KAMINO_LENDING_PROGRAM_ADDRESS, role: AccountRole.READONLY },
      { address: KAMINO_LENDING_PROGRAM_ADDRESS, role: AccountRole.READONLY },
      { address: KAMINO_LENDING_PROGRAM_ADDRESS, role: AccountRole.READONLY },
    ]);
    expect([...(ix.data ?? [])]).toEqual([2, 218, 138, 235, 79, 201, 25, 102]);
  });

  it("refreshes an obligation with its reserve appended", () => {
    const ix = makeRefreshObligationIx(key(1), key(2), key(3));

    expect(ix.accounts).toEqual([
      { address: key(1), role: AccountRole.READONLY },
      { address: key(2), role: AccountRole.WRITABLE },
      { address: key(3), role: AccountRole.READONLY },
    ]);
    expect([...(ix.data ?? [])]).toEqual([33, 132, 147, 228, 151, 192, 72, 89]);
  });

  it("batch-refreshes reserves without price updates", () => {
    const ix = makeRefreshReservesBatchIx([
      { reserve: key(1), lendingMarket: key(2) },
      { reserve: key(3), lendingMarket: key(4) },
    ]);

    expect(ix.accounts).toEqual([
      { address: key(1), role: AccountRole.WRITABLE },
      { address: key(2), role: AccountRole.READONLY },
      { address: key(3), role: AccountRole.WRITABLE },
      { address: key(4), role: AccountRole.READONLY },
    ]);
    expect([...(ix.data ?? [])]).toEqual([144, 110, 26, 103, 162, 204, 252, 147, 1]);
  });
});
