import { address, type Address } from "@solana/kit";
import { BigNumber } from "bignumber.js";
import { describe, expect, it } from "vitest";

import { TransactionBuildingError, TransactionBuildingErrorCode } from "~/errors";
import {
  AccountFlags,
  BalanceType,
  buildOrderTrigger,
  computeOrderPairNetValue,
  dtoToMarginfiAccount,
  getActiveAccountFlags,
  marginfiAccountToDto,
  MarginfiAccountType,
  resolveOrderLegs,
} from "~/services/account";
import { AssetTag, BankType, OperationalState, RiskTier } from "~/services/bank";
import { OraclePrice } from "~/services/price";
import {
  deriveOrderPda,
  maxSlippageU32ToPercent,
  percentToMaxSlippageU32,
  wrappedI80F48toBigNumber,
} from "~/utils";

const PROGRAM_ID = address("MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA");
const ACCOUNT = address("11111111111111111111111111111112");
const BANK_A = address("CCKtUs6Cgwo4aaQUmBPmyoApH2gUDErxNZCAntD6LYGh");
const BANK_B = address("2s37akK2eyBbp8DZgCm7RtsaEz8eJE3Nbb2b9dEVRR6d");

const expectBuildError = (run: () => unknown, code: TransactionBuildingErrorCode) => {
  try {
    run();
    expect.unreachable();
  } catch (error) {
    expect(error).toBeInstanceOf(TransactionBuildingError);
    expect((error as TransactionBuildingError).code).toBe(code);
  }
};

describe("deriveOrderPda", () => {
  it("matches the PDA main's web3.js derivation produces", async () => {
    const [orderPda] = await deriveOrderPda(PROGRAM_ID, ACCOUNT, [BANK_A, BANK_B]);
    expect(orderPda).toBe("DN9chMywrHaiAxt7StCrUWTVYoKYVEa2QasjmhkuysAb");
  });

  it("is independent of the bank key order", async () => {
    const [orderPda] = await deriveOrderPda(PROGRAM_ID, ACCOUNT, [BANK_A, BANK_B]);
    const [orderPdaReversed] = await deriveOrderPda(PROGRAM_ID, ACCOUNT, [BANK_B, BANK_A]);
    expect(orderPda).toBe(orderPdaReversed);
  });

  it("differs per pair", async () => {
    const [orderPda] = await deriveOrderPda(PROGRAM_ID, ACCOUNT, [BANK_A, BANK_B]);
    const [otherPairOrderPda] = await deriveOrderPda(PROGRAM_ID, ACCOUNT, [BANK_A, ACCOUNT]);
    expect(orderPda).not.toBe(otherPairOrderPda);
  });
});

describe("slippage conversion", () => {
  it("round-trips percent through the u32 fraction", () => {
    expect(maxSlippageU32ToPercent(percentToMaxSlippageU32(1))).toBeCloseTo(1, 6);
    expect(percentToMaxSlippageU32(10)).toBe(Math.floor(4294967295 / 10));
  });

  it("rejects values outside the protocol cap", () => {
    expect(() => percentToMaxSlippageU32(0)).toThrow();
    expect(() => percentToMaxSlippageU32(10.5)).toThrow();
  });
});

describe("buildOrderTrigger", () => {
  it("builds a stop-loss-only trigger", () => {
    const trigger = buildOrderTrigger({ stopLossUsd: new BigNumber(90), maxSlippagePercent: 1 });
    expect(trigger.__kind).toBe("StopLoss");
    if (trigger.__kind === "StopLoss") {
      expect(wrappedI80F48toBigNumber(trigger.threshold).toNumber()).toBe(90);
      expect(trigger.maxSlippage).toBe(percentToMaxSlippageU32(1));
    }
  });

  it("builds a both trigger when both thresholds are set", () => {
    const trigger = buildOrderTrigger({
      stopLossUsd: new BigNumber(90),
      takeProfitUsd: new BigNumber(120),
      maxSlippagePercent: 2,
    });
    expect(trigger.__kind).toBe("Both");
    if (trigger.__kind === "Both") {
      expect(wrappedI80F48toBigNumber(trigger.takeProfit).toNumber()).toBe(120);
    }
  });

  it("rejects take-profit at or below stop-loss, and empty triggers", () => {
    expectBuildError(
      () =>
        buildOrderTrigger({
          stopLossUsd: new BigNumber(100),
          takeProfitUsd: new BigNumber(100),
          maxSlippagePercent: 1,
        }),
      TransactionBuildingErrorCode.ORDER_INVALID_TRIGGER
    );
    expectBuildError(
      () => buildOrderTrigger({ maxSlippagePercent: 1 }),
      TransactionBuildingErrorCode.ORDER_INVALID_TRIGGER
    );
  });

  it("rejects thresholds that are not above 0, like the program", () => {
    for (const thresholds of [
      { stopLossUsd: new BigNumber(0) },
      { takeProfitUsd: new BigNumber(-5) },
      { stopLossUsd: new BigNumber(0), takeProfitUsd: new BigNumber(120) },
    ]) {
      expectBuildError(
        () => buildOrderTrigger({ ...thresholds, maxSlippagePercent: 1 }),
        TransactionBuildingErrorCode.ORDER_INVALID_TRIGGER
      );
    }
  });

  it("rejects slippage outside the cap", () => {
    expectBuildError(
      () => buildOrderTrigger({ stopLossUsd: new BigNumber(90), maxSlippagePercent: 0 }),
      TransactionBuildingErrorCode.ORDER_INVALID_SLIPPAGE
    );
  });
});

const balance = (
  bankPk: Address,
  tag: number,
  side: { assets?: number; liabilities?: number }
): BalanceType => ({
  active: true,
  bankPk,
  tag,
  assetShares: new BigNumber(side.assets ?? 0),
  liabilityShares: new BigNumber(side.liabilities ?? 0),
  premiumRate: new BigNumber(0),
  premiumOutstanding: new BigNumber(0),
  lastUpdate: 0,
});

const accountWith = (balances: BalanceType[]): MarginfiAccountType =>
  ({ address: ACCOUNT, balances, activeOrders: 1 }) as unknown as MarginfiAccountType;

describe("resolveOrderLegs", () => {
  it("maps the tagged balances to collateral and debt", () => {
    const account = accountWith([
      balance(BANK_A, 3, { assets: 10 }),
      balance(BANK_B, 4, { liabilities: 5 }),
    ]);
    expect(resolveOrderLegs(account, { tags: [4, 3] })).toEqual({
      collateralBank: BANK_A,
      debtBank: BANK_B,
    });
  });

  it("ignores dust liability shares left on the collateral balance", () => {
    const account = accountWith([
      balance(BANK_A, 3, { assets: 10, liabilities: 0.5 }),
      balance(BANK_B, 4, { liabilities: 5 }),
    ]);
    expect(resolveOrderLegs(account, { tags: [3, 4] })).toEqual({
      collateralBank: BANK_A,
      debtBank: BANK_B,
    });
  });

  it("returns null for a closed leg", () => {
    const account = accountWith([balance(BANK_A, 3, { assets: 10 })]);
    expect(resolveOrderLegs(account, { tags: [3, 4] })).toEqual({
      collateralBank: BANK_A,
      debtBank: null,
    });
  });
});

const bank = (address: Address, riskTier = RiskTier.Collateral): BankType =>
  ({
    address,
    mint: address,
    mintDecimals: 0,
    assetShareValue: new BigNumber(1),
    liabilityShareValue: new BigNumber(1),
    config: {
      riskTier,
      operationalState: OperationalState.Operational,
      assetTag: AssetTag.DEFAULT,
      assetWeightInit: new BigNumber(0.8),
      assetWeightMaint: new BigNumber(0.9),
      liabilityWeightInit: new BigNumber(1.25),
      liabilityWeightMaint: new BigNumber(1.1),
    },
  }) as unknown as BankType;

// Spot 100 but EMA 90 with a band of 88..92, so only the EMA band can produce the expected values.
const oraclePrice = (): OraclePrice =>
  ({
    priceRealtime: {
      price: new BigNumber(100),
      confidence: new BigNumber(0),
      lowestPrice: new BigNumber(100),
      highestPrice: new BigNumber(100),
    },
    priceWeighted: {
      price: new BigNumber(90),
      confidence: new BigNumber(2),
      lowestPrice: new BigNumber(88),
      highestPrice: new BigNumber(92),
    },
    timestamp: new BigNumber(0),
  }) as OraclePrice;

describe("computeOrderPairNetValue", () => {
  it("values the pair at the EMA band like the program trigger", () => {
    const value = computeOrderPairNetValue({
      collateral: {
        balance: balance(BANK_A, 3, { assets: 10 }),
        bank: bank(BANK_A),
        oraclePrice: oraclePrice(),
      },
      debt: {
        balance: balance(BANK_B, 4, { liabilities: 5 }),
        bank: bank(BANK_B),
        oraclePrice: oraclePrice(),
      },
    });
    expect(value.collateralUsd.toNumber()).toBe(880);
    expect(value.debtUsd.toNumber()).toBe(460);
    expect(value.netUsd.toNumber()).toBe(420);
  });

  it("counts isolated-tier collateral as zero", () => {
    const value = computeOrderPairNetValue({
      collateral: {
        balance: balance(BANK_A, 3, { assets: 10 }),
        bank: bank(BANK_A, RiskTier.Isolated),
        oraclePrice: oraclePrice(),
      },
      debt: {
        balance: balance(BANK_B, 4, { liabilities: 5 }),
        bank: bank(BANK_B),
        oraclePrice: oraclePrice(),
      },
    });
    expect(value.collateralUsd.toNumber()).toBe(0);
    expect(value.netUsd.toNumber()).toBe(-460);
  });
});

describe("account order fields", () => {
  it("parses the receivership, deleverage, frozen and order-execution flags", () => {
    const flags = getActiveAccountFlags(BigInt((1 << 4) | (1 << 5) | (1 << 6) | (1 << 7)));
    expect(flags).toEqual([
      AccountFlags.ACCOUNT_IN_RECEIVERSHIP,
      AccountFlags.ACCOUNT_IN_DELEVERAGE,
      AccountFlags.ACCOUNT_FROZEN,
      AccountFlags.ACCOUNT_IN_ORDER_EXECUTION,
    ]);
  });

  it("round-trips activeOrders through the DTO and defaults it for older DTOs", () => {
    const account: MarginfiAccountType = {
      address: ACCOUNT,
      group: ACCOUNT,
      authority: ACCOUNT,
      balances: [],
      accountFlags: [],
      healthCache: {
        assetValue: new BigNumber(0),
        liabilityValue: new BigNumber(0),
        assetValueMaint: new BigNumber(0),
        liabilityValueMaint: new BigNumber(0),
        assetValueEquity: new BigNumber(0),
        liabilityValueEquity: new BigNumber(0),
        timestamp: new BigNumber(0),
        flags: [],
        prices: [],
        simulationStatus: 0,
      },
      activeOrders: 2,
    };
    const dto = marginfiAccountToDto(account);
    expect(dto.activeOrders).toBe(2);
    expect(dtoToMarginfiAccount(dto).activeOrders).toBe(2);
    expect(dtoToMarginfiAccount({ ...dto, activeOrders: undefined }).activeOrders).toBe(0);
  });
});
