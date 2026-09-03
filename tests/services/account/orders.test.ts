import { describe, expect, it } from "vitest";
import { PublicKey } from "@solana/web3.js";
import BigNumber from "bignumber.js";

import { buildOrderTrigger } from "~/services/account";
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
    expect(percentToMaxSlippageU32(10)).toBe(Math.round(4294967295 / 10));
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
