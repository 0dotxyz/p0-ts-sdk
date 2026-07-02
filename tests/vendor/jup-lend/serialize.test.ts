import { describe, expect, it } from "vitest";
import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";

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
  new PublicKey(Buffer.from(Array.from({ length: 32 }, (_, i) => (seed + i) % 256)));

const tokenReserve: JupTokenReserve = {
  pubkey: pk(1),
  borrowRate: 550,
  feeOnInterest: 1000,
  lastUtilization: 7500,
  supplyExchangePrice: new BN("1002340000"),
  borrowExchangePrice: new BN("1005670000"),
  totalSupplyWithInterest: new BN("123456789012"),
  totalSupplyInterestFree: new BN("222"),
  totalBorrowWithInterest: new BN("98765432101"),
  totalBorrowInterestFree: new BN("111"),
};

const rewardsModel: JupLendingRewardsRateModel = {
  startTvl: new BN("1000000000"),
  duration: new BN("2592000"),
  startTime: new BN("1780000000"),
  yearlyReward: new BN("500000000000"),
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
    expect(dtoToJupTokenReserveRaw(jupTokenReserveRawToDto(tokenReserve))).toEqual(
      tokenReserve
    );
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
      lastUpdateTimestamp: new BN(1),
      maxUtilization: 10000,
      totalClaimAmount: new BN(0),
      interactingProtocol: pk(4),
      interactingTimestamp: new BN(0),
      interactingBalance: new BN(0),
    };
    const dto = jupTokenReserveRawToDto(rawLike);
    expect(dto).not.toHaveProperty("mint");
    expect(dto).not.toHaveProperty("vault");
    expect(dto).not.toHaveProperty("interactingProtocol");
    expect(dtoToJupTokenReserveRaw(dto)).toEqual(tokenReserve);
  });
});
