import { describe, expect, it } from "vitest";

import { key } from "../../helpers/addresses";

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

const reserve: KaminoReserve = {
  lendingMarket: key(1),
  farmCollateral: key(2),
  liquidity: {
    mintPubkey: key(3),
    supplyVault: key(4),
    mintDecimals: 9n,
    totalAvailableAmount: 123456789n,
    borrowedAmountSf: 987654321000000000n,
    accumulatedProtocolFeesSf: 111n,
    accumulatedReferrerFeesSf: 222n,
    pendingReferrerFeesSf: 333n,
  },
  collateral: {
    mintPubkey: key(5),
    mintTotalSupply: 55555555n,
    supplyVault: key(6),
  },
  withdrawQueue: { queuedCollateralAmount: 1234n },
  config: {
    protocolTakeRatePct: 15,
    hostFixedInterestRateBps: 25,
    emergencyMode: 0,
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
      scopeConfiguration: { priceFeed: key(7) },
      switchboardConfiguration: { priceAggregator: key(8), twapAggregator: key(9) },
      pythConfiguration: { price: key(10) },
    },
  },
};

const obligation: KaminoObligation = {
  lendingMarket: key(1),
  owner: key(11),
  deposits: [{ depositReserve: key(12), depositedAmount: 777n, marketValueSf: 888n }],
  borrows: [{ borrowReserve: key(13), borrowedAmountSf: 999n, marketValueSf: 1010n }],
};

const farmState: KaminoFarmState = {
  token: { mint: key(14), decimals: 6n },
  rewardInfos: [
    {
      token: { mint: key(15), decimals: 9n },
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
      farmDebt: key(20),
      padding: [0n],
    };
    const dto = kaminoReserveToDto(rawLike);
    expect(dto).not.toHaveProperty("version");
    expect(dto).not.toHaveProperty("farmDebt");
    expect(dto).not.toHaveProperty("padding");
    expect(dtoToKaminoReserve(dto)).toEqual(reserve);
  });
});
