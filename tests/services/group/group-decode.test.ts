import { address } from "@solana/kit";
import { describe, expect, it } from "vitest";

import {
  getMarginfiGroupDecoder,
  getMarginfiGroupEncoder,
  getMarginfiGroupSize,
  MARGINFI_GROUP_DISCRIMINATOR,
} from "~/generated/marginfi";
import { MarginfiGroup } from "~/models/group";

const U32_MAX = 0xffffffff;
const groupAddress = address("4qp6Fx6tnZkY5Wropq9wUYgtFxXKwE6viZxFHg3rdAG8");

// An all-zero group account with the right discriminator (no premium table configured).
const zeroedGroupData = () => {
  const data = new Uint8Array(getMarginfiGroupSize());
  data.set(MARGINFI_GROUP_DISCRIMINATOR);
  return data;
};

describe("MarginfiGroup premium table decoding", () => {
  it("keeps the live entries (the first entryCount) with rates as APR fractions", () => {
    const raw = getMarginfiGroupDecoder().decode(zeroedGroupData());
    const premiumEntries = [...raw.premiumEntries];
    [
      [2, 1, 0.05],
      [4, 1, 0.5],
      [9, 9, 0.9],
    ].forEach(([collateralTag, liabilityTag, rate], i) => {
      premiumEntries[i] = {
        ...premiumEntries[i],
        collateralTag,
        liabilityTag,
        rate: Math.round((rate * U32_MAX) / 10),
      };
    });
    const data = getMarginfiGroupEncoder().encode({
      ...raw,
      premiumSettings: { ...raw.premiumSettings, entryCount: 2 },
      premiumEntries,
    });

    const group = MarginfiGroup.fromBuffer(groupAddress, data);

    expect(group.premiumEntries.map((e) => [e.collateralTag, e.liabilityTag])).toEqual([
      [2, 1],
      [4, 1],
    ]);
    expect(group.premiumEntries[0].rate.toNumber()).toBeCloseTo(0.05, 8);
    expect(group.premiumEntries[1].rate.toNumber()).toBeCloseTo(0.5, 8);
  });

  it("decodes an empty table when the group has no premium configured", () => {
    expect(MarginfiGroup.fromBuffer(groupAddress, zeroedGroupData()).premiumEntries).toEqual([]);
  });
});
