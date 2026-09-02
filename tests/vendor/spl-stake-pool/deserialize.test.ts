import { describe, it, expect } from "vitest";

import { decodeStakePool } from "~/vendor/spl-stake-pool";

function stakePoolData(
  totalLamports: bigint,
  poolTokenSupply: bigint,
  lastUpdateEpoch: bigint,
  accountType = 1
): Buffer {
  const data = Buffer.alloc(300);
  data[0] = accountType;
  data.writeBigUInt64LE(totalLamports, 258);
  data.writeBigUInt64LE(poolTokenSupply, 266);
  data.writeBigUInt64LE(lastUpdateEpoch, 274);
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
    expect(() => decodeStakePool(Buffer.alloc(100))).toThrow();
  });

  it("rejects out-of-bounds rates", () => {
    expect(() => decodeStakePool(stakePoolData(0n, 1_000_000_000_000n, 700n))).toThrow();
    expect(() => decodeStakePool(stakePoolData(3_000n, 1_000n, 700n))).toThrow();
  });
});
