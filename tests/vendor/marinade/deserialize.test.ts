import { describe, it, expect } from "vitest";

import {
  decodeMarinadeState,
  MARINADE_STATE_DISCRIMINATOR,
  MARINADE_STATE_MIN_SIZE,
} from "~/vendor/marinade";

// The real mainnet State account (8szGkuLT...) is 2616 bytes; the program reads the prefix through
// emergency_cooling_down @568 to derive total_virtual_staked_lamports.
const MAINNET_STATE_SIZE = 2616;

function marinadeStateData(
  overrides: Partial<{
    delayedUnstakeCoolingDown: bigint;
    totalActiveBalance: bigint;
    availableReserveBalance: bigint;
    msolSupply: bigint;
    cachedMsolPrice: bigint;
    circulatingTicketBalance: bigint;
    emergencyCoolingDown: bigint;
  }> = {},
  size = MAINNET_STATE_SIZE
): Uint8Array {
  const fields = {
    delayedUnstakeCoolingDown: 0n,
    totalActiveBalance: 1_403_721_040n,
    availableReserveBalance: 0n,
    msolSupply: 1_000_000_000n,
    cachedMsolPrice: 0n,
    circulatingTicketBalance: 0n,
    emergencyCoolingDown: 0n,
    ...overrides,
  };
  const data = new Uint8Array(size);
  data.set(MARINADE_STATE_DISCRIMINATOR, 0);
  if (size >= MARINADE_STATE_MIN_SIZE) {
    const view = new DataView(data.buffer);
    view.setBigUint64(226, fields.delayedUnstakeCoolingDown, true);
    view.setBigUint64(376, fields.totalActiveBalance, true);
    view.setBigUint64(496, fields.availableReserveBalance, true);
    view.setBigUint64(504, fields.msolSupply, true);
    view.setBigUint64(512, fields.cachedMsolPrice, true);
    view.setBigUint64(528, fields.circulatingTicketBalance, true);
    view.setBigUint64(568, fields.emergencyCoolingDown, true);
  }
  return data;
}

describe("decodeMarinadeState", () => {
  it("derives the canonical mSOL rate from live balances and ignores cached msol_price", () => {
    const state = decodeMarinadeState(
      marinadeStateData({
        delayedUnstakeCoolingDown: 10n,
        totalActiveBalance: 1_300n,
        availableReserveBalance: 200n,
        msolSupply: 1_000n,
        cachedMsolPrice: 1n,
        circulatingTicketBalance: 50n,
        emergencyCoolingDown: 40n,
      })
    );
    expect(state.msolPrice.toNumber()).toBeCloseTo(1.5, 12);
  });

  it("accepts the minimal prefix needed by the program", () => {
    const state = decodeMarinadeState(marinadeStateData({}, MARINADE_STATE_MIN_SIZE));
    expect(state.msolPrice.toNumber()).toBeCloseTo(1.40372104, 8);
  });

  it("rejects undersized accounts", () => {
    expect(() => decodeMarinadeState(marinadeStateData().subarray(0, 575))).toThrow();
  });

  it("rejects a wrong discriminator", () => {
    const data = marinadeStateData();
    data[0] ^= 0xff;
    expect(() => decodeMarinadeState(data)).toThrow();
  });

  it("rejects out-of-bounds rates", () => {
    expect(() => decodeMarinadeState(marinadeStateData({ msolSupply: 0n }))).toThrow();
    expect(() =>
      decodeMarinadeState(marinadeStateData({ totalActiveBalance: 3_000n, msolSupply: 1_000n }))
    ).toThrow();
    expect(() =>
      decodeMarinadeState(
        marinadeStateData({
          totalActiveBalance: (1n << 64n) - 1n,
          availableReserveBalance: 1n,
        })
      )
    ).toThrow();
  });
});
