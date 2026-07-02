import { describe, expect, it } from "vitest";
import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";

import {
  KaminoFarmState,
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
  new PublicKey(Buffer.from(Array.from({ length: 32 }, (_, i) => (seed + i) % 256)));

const reserve: KaminoReserve = {
  lendingMarket: pk(1),
  farmCollateral: pk(2),
  liquidity: {
    mintPubkey: pk(3),
    supplyVault: pk(4),
    mintDecimals: new BN(9),
    availableAmount: new BN("123456789"),
    borrowedAmountSf: new BN("987654321000000000"),
    accumulatedProtocolFeesSf: new BN("111"),
    accumulatedReferrerFeesSf: new BN("222"),
    pendingReferrerFeesSf: new BN("333"),
  },
  collateral: {
    mintPubkey: pk(5),
    mintTotalSupply: new BN("55555555"),
    supplyVault: pk(6),
  },
  config: {
    protocolTakeRatePct: 15,
    hostFixedInterestRateBps: 25,
    depositLimit: new BN("10000000000000000"),
    borrowLimit: new BN("9000000000000000"),
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
  deposits: [
    { depositReserve: pk(12), depositedAmount: new BN("777"), marketValueSf: new BN("888") },
  ],
  borrows: [
    { borrowReserve: pk(13), borrowedAmountSf: new BN("999"), marketValueSf: new BN("1010") },
  ],
};

const farmState: KaminoFarmState = {
  token: { mint: pk(14), decimals: new BN(6) },
  rewardInfos: [
    {
      token: { mint: pk(15), decimals: new BN(9) },
      rewardsAvailable: new BN("123456"),
      rewardsPerSecondDecimals: 8,
      rewardScheduleCurve: {
        points: [
          { tsStart: new BN("1700000000"), rewardPerTimeUnit: new BN("42") },
          { tsStart: new BN("1800000000"), rewardPerTimeUnit: new BN("0") },
        ],
      },
    },
  ],
};

describe("klend curated type round-trips", () => {
  it("round-trips KaminoReserve through its DTO", () => {
    expect(dtoToKaminoReserve(kaminoReserveToDto(reserve))).toEqual(reserve);
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
      version: new BN(1),
      farmDebt: pk(20),
      padding: [new BN(0)],
    };
    const dto = kaminoReserveToDto(rawLike);
    expect(dto).not.toHaveProperty("version");
    expect(dto).not.toHaveProperty("farmDebt");
    expect(dto).not.toHaveProperty("padding");
    expect(dtoToKaminoReserve(dto)).toEqual(reserve);
  });
});
