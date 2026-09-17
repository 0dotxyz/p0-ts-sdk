import { getAddressDecoder } from "@solana/kit";
import { describe, expect, it } from "vitest";

import {
  KaminoFarmState,
  KaminoInterestRateBasis,
  KaminoObligation,
  KaminoReserve,
  dtoToKaminoFarmState,
  dtoToKaminoObligation,
  dtoToKaminoReserve,
  kaminoFarmStateToDto,
  kaminoObligationToDto,
  kaminoReserveToDto,
} from "~/vendor/klend";

const pk = (seed: number) =>
  getAddressDecoder().decode(Uint8Array.from({ length: 32 }, (_, i) => (seed + i) % 256));

const reserve: KaminoReserve = {
  lendingMarket: pk(1),
  farmCollateral: pk(2),
  liquidity: {
    mintPubkey: pk(3),
    supplyVault: pk(4),
    mintDecimals: 9n,
    totalAvailableAmount: 123456789n,
    borrowedAmountSf: 987654321000000000n,
    accumulatedProtocolFeesSf: 111n,
    accumulatedReferrerFeesSf: 222n,
    pendingReferrerFeesSf: 333n,
  },
  collateral: {
    mintPubkey: pk(5),
    mintTotalSupply: 55555555n,
    supplyVault: pk(6),
  },
  config: {
    protocolTakeRatePct: 15,
    hostFixedInterestRateBps: 25,
    interestRateBasis: KaminoInterestRateBasis.TrueApr,
    depositLimit: 10000000000000000n,
    borrowLimit: 9000000000000000n,
    borrowRateCurve: {
      points: [
        { utilizationRateBps: 0, borrowRateBps: 100 },
        { utilizationRateBps: 8000, borrowRateBps: 500 },
        { utilizationRateBps: 10000, borrowRateBps: 5000 },
      ],
    },
    tokenInfo: {
      scopeConfiguration: { priceFeed: pk(7) },
      switchboardConfiguration: { priceAggregator: pk(8), twapAggregator: pk(9) },
      pythConfiguration: { price: pk(10) },
    },
  },
};

const obligation: KaminoObligation = {
  lendingMarket: pk(1),
  owner: pk(11),
  deposits: [{ depositReserve: pk(12), depositedAmount: 777n, marketValueSf: 888n }],
  borrows: [{ borrowReserve: pk(13), borrowedAmountSf: 999n, marketValueSf: 1010n }],
};

const farmState: KaminoFarmState = {
  token: { mint: pk(14), decimals: 6n },
  rewardInfos: [
    {
      token: { mint: pk(15), decimals: 9n },
      rewardsAvailable: 123456n,
      rewardsPerSecondDecimals: 8,
      rewardScheduleCurve: {
        points: [
          { tsStart: 1700000000n, rewardPerTimeUnit: 42n },
          { tsStart: 1800000000n, rewardPerTimeUnit: 0n },
        ],
      },
    },
  ],
};

describe("klend curated type round-trips", () => {
  it("round-trips KaminoReserve through its DTO", () => {
    expect(dtoToKaminoReserve(kaminoReserveToDto(reserve))).toEqual(reserve);
  });

  it("defaults interestRateBasis to Legacy when missing from the DTO", () => {
    const { interestRateBasis, ...legacyConfig } = kaminoReserveToDto(reserve).config;
    const dto = { ...kaminoReserveToDto(reserve), config: legacyConfig };
    expect(dtoToKaminoReserve(dto).config.interestRateBasis).toBe(KaminoInterestRateBasis.Legacy);

    const { interestRateBasis: _basis, ...legacyReserveConfig } = reserve.config;
    const legacyReserve = { ...reserve, config: legacyReserveConfig };
    expect(kaminoReserveToDto(legacyReserve).config.interestRateBasis).toBe(
      KaminoInterestRateBasis.Legacy
    );
  });

  it("round-trips KaminoObligation through its DTO", () => {
    expect(dtoToKaminoObligation(kaminoObligationToDto(obligation))).toEqual(obligation);
  });

  it("round-trips KaminoFarmState through its DTO", () => {
    expect(dtoToKaminoFarmState(kaminoFarmStateToDto(farmState))).toEqual(farmState);
  });

  it("tolerates obligation DTOs with pruned empty position arrays", () => {
    const dto = kaminoObligationToDto(obligation);
    const { deposits, borrows, ...pruned } = dto;
    const decoded = dtoToKaminoObligation(pruned as typeof dto);
    expect(decoded.deposits).toEqual([]);
    expect(decoded.borrows).toEqual([]);
    expect(decoded.owner).toEqual(obligation.owner);
  });

  it("trims extra raw fields at the DTO boundary via structural typing", () => {
    const rawLike = {
      ...reserve,
      version: 1n,
      farmDebt: pk(20),
      padding: [0n],
    };
    const dto = kaminoReserveToDto(rawLike);
    expect(dto).not.toHaveProperty("version");
    expect(dto).not.toHaveProperty("farmDebt");
    expect(dto).not.toHaveProperty("padding");
    expect(dtoToKaminoReserve(dto)).toEqual(reserve);
  });
});
