import { PublicKey } from "@solana/web3.js";
import BigNumber from "bignumber.js";
import BN from "bn.js";
import { describe, expect, it } from "vitest";

import {
  AccountFlags,
  BalanceType,
  buildOrderTrigger,
  computeOrderPairNetValue,
  dtoToMarginfiAccount,
  getActiveAccountFlags,
  marginfiAccountToDto,
  MarginfiAccountType,
  resolveOrderBanks,
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

const PROGRAM_ID = new PublicKey("MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA");
const ACCOUNT = new PublicKey("11111111111111111111111111111112");
const BANK_A = new PublicKey("CCKtUs6Cgwo4aaQUmBPmyoApH2gUDErxNZCAntD6LYGh");
const BANK_B = new PublicKey("2s37akK2eyBbp8DZgCm7RtsaEz8eJE3Nbb2b9dEVRR6d");

describe("deriveOrderPda", () => {
  it("is independent of the bank key order", () => {
    const [orderPda] = deriveOrderPda(PROGRAM_ID, ACCOUNT, [BANK_A, BANK_B]);
    const [orderPdaReversed] = deriveOrderPda(PROGRAM_ID, ACCOUNT, [BANK_B, BANK_A]);
    expect(orderPda.equals(orderPdaReversed)).toBe(true);
  });

  it("differs per pair", () => {
    const [orderPda] = deriveOrderPda(PROGRAM_ID, ACCOUNT, [BANK_A, BANK_B]);
    const [otherPairOrderPda] = deriveOrderPda(PROGRAM_ID, ACCOUNT, [BANK_A, ACCOUNT]);
    expect(orderPda.equals(otherPairOrderPda)).toBe(false);
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
    expect("stopLoss" in trigger).toBe(true);
    if ("stopLoss" in trigger) {
      expect(wrappedI80F48toBigNumber(trigger.stopLoss.threshold).toNumber()).toBe(90);
      expect(trigger.stopLoss.maxSlippage).toBe(percentToMaxSlippageU32(1));
    }
  });

  it("builds a both trigger when both thresholds are set", () => {
    const trigger = buildOrderTrigger({
      stopLossUsd: new BigNumber(90),
      takeProfitUsd: new BigNumber(120),
      maxSlippagePercent: 2,
    });
    expect("both" in trigger).toBe(true);
    if ("both" in trigger) {
      expect(wrappedI80F48toBigNumber(trigger.both.takeProfit).toNumber()).toBe(120);
    }
  });

  it("rejects take-profit at or below stop-loss, and empty triggers", () => {
    expect(() =>
      buildOrderTrigger({
        stopLossUsd: new BigNumber(100),
        takeProfitUsd: new BigNumber(100),
        maxSlippagePercent: 1,
      })
    ).toThrow();
    expect(() => buildOrderTrigger({ maxSlippagePercent: 1 })).toThrow();
  });
});

const balance = (
  bankPk: PublicKey,
  tag: number,
  side: { assets?: number; liabilities?: number }
): BalanceType =>
  ({
    active: true,
    bankPk,
    tag,
    assetShares: new BigNumber(side.assets ?? 0),
    liabilityShares: new BigNumber(side.liabilities ?? 0),
    emissionsOutstanding: new BigNumber(0),
    lastUpdate: 0,
  }) as BalanceType;

const accountWith = (balances: BalanceType[]): MarginfiAccountType =>
  ({ address: ACCOUNT, balances, activeOrders: 1 }) as MarginfiAccountType;

describe("resolveOrderLegs", () => {
  it("maps the tagged balances to collateral and debt", () => {
    const account = accountWith([
      balance(BANK_A, 3, { assets: 10 }),
      balance(BANK_B, 4, { liabilities: 5 }),
    ]);
    const legs = resolveOrderLegs(account, { tags: [4, 3] });
    expect(legs.collateralBank?.equals(BANK_A)).toBe(true);
    expect(legs.debtBank?.equals(BANK_B)).toBe(true);
  });

  it("returns null for a closed leg instead of throwing", () => {
    const account = accountWith([balance(BANK_A, 3, { assets: 10 })]);
    const order = { address: ACCOUNT, tags: [3, 4] as [number, number] };
    expect(resolveOrderLegs(account, order)).toEqual({
      collateralBank: BANK_A,
      debtBank: null,
    });
    expect(() => resolveOrderBanks(account, order)).toThrow();
  });
});

const bank = (address: PublicKey, riskTier = RiskTier.Collateral): BankType =>
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
    const flags = getActiveAccountFlags(new BN((1 << 4) | (1 << 5) | (1 << 6) | (1 << 7)));
    expect(flags).toEqual([
      AccountFlags.ACCOUNT_IN_RECEIVERSHIP,
      AccountFlags.ACCOUNT_IN_DELEVERAGE,
      AccountFlags.ACCOUNT_FROZEN,
      AccountFlags.ACCOUNT_IN_ORDER_EXECUTION,
    ]);
  });

  it("round-trips activeOrders through the DTO and defaults it for older DTOs", () => {
    const account = {
      address: ACCOUNT,
      group: ACCOUNT,
      authority: ACCOUNT,
      balances: [],
      accountFlags: [],
      emissionsDestinationAccount: ACCOUNT,
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
    } as unknown as MarginfiAccountType;
    const dto = marginfiAccountToDto(account);
    expect(dto.activeOrders).toBe(2);
    expect(dtoToMarginfiAccount(dto).activeOrders).toBe(2);
    expect(dtoToMarginfiAccount({ ...dto, activeOrders: undefined }).activeOrders).toBe(0);
  });
});
