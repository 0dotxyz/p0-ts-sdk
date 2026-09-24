import { describe, it, expect } from "vitest";

import { decodeStakePool } from "~/vendor/spl-stake-pool";

function stakePoolData(
  totalLamports: bigint,
  poolTokenSupply: bigint,
  lastUpdateEpoch: bigint,
  accountType = 1
): Uint8Array {
  const data = new Uint8Array(300);
  data[0] = accountType;
  const view = new DataView(data.buffer);
  view.setBigUint64(258, totalLamports, true);
  view.setBigUint64(266, poolTokenSupply, true);
  view.setBigUint64(274, lastUpdateEpoch, true);
  return data;
}

describe("decodeStakePool", () => {
  it("reads total_lamports / pool_token_supply as the exchange rate", () => {
    const pool = decodeStakePool(stakePoolData(1_292_015_000_000n, 1_000_000_000_000n, 700n));
    expect(pool.totalLamports).toBe(1_292_015_000_000n);
    expect(pool.poolTokenSupply).toBe(1_000_000_000_000n);
    expect(pool.lastUpdateEpoch).toBe(700);
    expect(pool.exchangeRate.toNumber()).toBeCloseTo(1.292015, 9);
  });

  it("rejects zero supply, wrong account type, and short buffers", () => {
    expect(() => decodeStakePool(stakePoolData(1_000n, 0n, 700n))).toThrow();
    expect(() => decodeStakePool(stakePoolData(1_000n, 1_000n, 700n, 2))).toThrow();
    expect(() => decodeStakePool(new Uint8Array(100))).toThrow();
  });

  it("rejects out-of-bounds rates", () => {
    expect(() => decodeStakePool(stakePoolData(0n, 1_000_000_000_000n, 700n))).toThrow();
    expect(() => decodeStakePool(stakePoolData(3_000n, 1_000n, 700n))).toThrow();
  });
});
