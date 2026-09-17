import { getAddressDecoder } from "@solana/kit";
import { describe, expect, it } from "vitest";

import {
  JupLendingRewardsRateModel,
  JupRateModel,
  JupTokenReserve,
  dtoToJupLendingRewardsRateModelRaw,
  dtoToJupRateModelRaw,
  dtoToJupTokenReserveRaw,
  jupLendingRewardsRateModelRawToDto,
  jupRateModelRawToDto,
  jupTokenReserveRawToDto,
} from "~/vendor/jup-lend";

const pk = (seed: number) =>
  getAddressDecoder().decode(Uint8Array.from({ length: 32 }, (_, i) => (seed + i) % 256));

const tokenReserve: JupTokenReserve = {
  pubkey: pk(1),
  borrowRate: 550,
  feeOnInterest: 1000,
  lastUtilization: 7500,
  supplyExchangePrice: 1002340000n,
  borrowExchangePrice: 1005670000n,
  totalSupplyWithInterest: 123456789012n,
  totalSupplyInterestFree: 222n,
  totalBorrowWithInterest: 98765432101n,
  totalBorrowInterestFree: 111n,
};

const rewardsModel: JupLendingRewardsRateModel = {
  startTvl: 1000000000n,
  duration: 2592000n,
  startTime: 1780000000n,
  yearlyReward: 500000000000n,
};

const rateModel: JupRateModel = {
  version: 1,
  rateAtZero: 0,
  kink1Utilization: 8000,
  rateAtKink1: 500,
  rateAtMax: 5000,
  kink2Utilization: 9500,
  rateAtKink2: 2000,
};

describe("jup-lend curated type round-trips", () => {
  it("round-trips JupTokenReserve through its DTO", () => {
    expect(dtoToJupTokenReserveRaw(jupTokenReserveRawToDto(tokenReserve))).toEqual(tokenReserve);
  });

  it("round-trips JupLendingRewardsRateModel through its DTO", () => {
    expect(
      dtoToJupLendingRewardsRateModelRaw(jupLendingRewardsRateModelRawToDto(rewardsModel))
    ).toEqual(rewardsModel);
  });

  it("round-trips JupRateModel through its DTO", () => {
    expect(dtoToJupRateModelRaw(jupRateModelRawToDto(rateModel))).toEqual(rateModel);
  });

  it("trims extra raw fields at the DTO boundary via structural typing", () => {
    const rawLike = {
      ...tokenReserve,
      mint: pk(2),
      vault: pk(3),
      lastUpdateTimestamp: 1n,
      maxUtilization: 10000,
      totalClaimAmount: 0n,
      interactingProtocol: pk(4),
      interactingTimestamp: 0n,
      interactingBalance: 0n,
    };
    const dto = jupTokenReserveRawToDto(rawLike);
    expect(dto).not.toHaveProperty("mint");
    expect(dto).not.toHaveProperty("vault");
    expect(dto).not.toHaveProperty("interactingProtocol");
    expect(dtoToJupTokenReserveRaw(dto)).toEqual(tokenReserve);
  });
});
