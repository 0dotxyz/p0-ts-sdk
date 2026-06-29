import { describe, it, expect } from "vitest";

import { computeBorrowEstimateForRepay } from "~/services/account/services/swap-engine/utils/market-estimate.utils";

describe("computeBorrowEstimateForRepay", () => {
  it("converts repay target into borrow units at market price (partial repay, slippage buffer only)", () => {
    // Repay 100 of a $1 token; borrow a $2 token. No-slippage equivalent = 50 borrow units.
    const est = computeBorrowEstimateForRepay({
      repayTargetUi: 100,
      repayMarketPrice: 1,
      borrowMarketPrice: 2,
      slippageBps: 50,
      isRepayAll: false,
    });
    // 50 * (1 + 50/10000) = 50 * 1.005 = 50.25
    expect(est).toBeCloseTo(50.25, 6);
  });

  it("adds the extra buffer for a full (repayAll) repay", () => {
    const partial = computeBorrowEstimateForRepay({
      repayTargetUi: 100,
      repayMarketPrice: 1,
      borrowMarketPrice: 2,
      slippageBps: 50,
      isRepayAll: false,
    });
    const full = computeBorrowEstimateForRepay({
      repayTargetUi: 100,
      repayMarketPrice: 1,
      borrowMarketPrice: 2,
      slippageBps: 50,
      isRepayAll: true,
    });
    // repayAll uses slippage(50) + extra(50) = 100bps -> 50 * 1.01 = 50.5
    expect(full).toBeCloseTo(50.5, 6);
    expect(full).toBeGreaterThan(partial);
  });

  it("defaults slippage to 50bps when unset", () => {
    const est = computeBorrowEstimateForRepay({
      repayTargetUi: 10,
      repayMarketPrice: 4,
      borrowMarketPrice: 1,
      isRepayAll: false,
    });
    // 40 * 1.005 = 40.2
    expect(est).toBeCloseTo(40.2, 6);
  });

  it("scales linearly with the price ratio", () => {
    const est = computeBorrowEstimateForRepay({
      repayTargetUi: 1,
      repayMarketPrice: 200, // e.g. SOL repay target priced at $200
      borrowMarketPrice: 1, // borrow a $1 stable
      slippageBps: 0,
      isRepayAll: false,
    });
    expect(est).toBeCloseTo(200, 6);
  });

  it("throws on a non-positive borrow price", () => {
    expect(() =>
      computeBorrowEstimateForRepay({
        repayTargetUi: 100,
        repayMarketPrice: 1,
        borrowMarketPrice: 0,
        isRepayAll: false,
      })
    ).toThrow(/borrowMarketPrice must be positive/);
  });
});
