import { getAddressDecoder } from "@solana/kit";
import { BigNumber } from "bignumber.js";
import { describe, it, expect } from "vitest";

import {
  isStandardBorrowable,
  isStandardDepositable,
  AssetTag,
  OperationalState,
  BankType,
} from "~/services/bank";

const uniqueAddress = () => getAddressDecoder().decode(crypto.getRandomValues(new Uint8Array(32)));

function bank(opts: {
  assetTag: AssetTag;
  operationalState: OperationalState;
  borrowLimit: number;
}): BankType {
  return {
    address: uniqueAddress(),
    mint: uniqueAddress(),
    config: {
      assetTag: opts.assetTag,
      operationalState: opts.operationalState,
      borrowLimit: new BigNumber(opts.borrowLimit),
    },
  } as unknown as BankType;
}

describe("isStandardBorrowable / isStandardDepositable", () => {
  it("native DEFAULT/SOL operational banks are borrowable + depositable", () => {
    const def = bank({
      assetTag: AssetTag.DEFAULT,
      operationalState: OperationalState.Operational,
      borrowLimit: 100,
    });
    const sol = bank({
      assetTag: AssetTag.SOL,
      operationalState: OperationalState.Operational,
      borrowLimit: 100,
    });
    expect(isStandardBorrowable(def)).toBe(true);
    expect(isStandardDepositable(def)).toBe(true);
    expect(isStandardBorrowable(sol)).toBe(true);
  });

  it("integration wrappers (Kamino/Drift/JupLend) are neither", () => {
    const kamino = bank({
      assetTag: AssetTag.KAMINO,
      operationalState: OperationalState.Operational,
      borrowLimit: 0,
    });
    expect(isStandardBorrowable(kamino)).toBe(false);
    expect(isStandardDepositable(kamino)).toBe(false);
  });

  it("ReduceOnly excludes both; zero borrowLimit excludes only borrowable", () => {
    const reduceOnly = bank({
      assetTag: AssetTag.DEFAULT,
      operationalState: OperationalState.ReduceOnly,
      borrowLimit: 100,
    });
    expect(isStandardBorrowable(reduceOnly)).toBe(false);
    expect(isStandardDepositable(reduceOnly)).toBe(false);

    const noBorrow = bank({
      assetTag: AssetTag.DEFAULT,
      operationalState: OperationalState.Operational,
      borrowLimit: 0,
    });
    expect(isStandardBorrowable(noBorrow)).toBe(false);
    expect(isStandardDepositable(noBorrow)).toBe(true); // deposit doesn't need a borrow limit
  });
});
