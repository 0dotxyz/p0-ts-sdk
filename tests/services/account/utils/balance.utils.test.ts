import type { Address } from "@solana/kit";
import { BigNumber } from "bignumber.js";
import { describe, expect, it } from "vitest";

import { addr, key } from "../../../helpers/addresses";

import {
  BalanceType,
  computeClosePositionTokenAmount,
  exceedsCostlyPositionLimit,
  isWholePosition,
  MarginfiAccountType,
  resolveOrderLegs,
} from "~/services/account";
import { AssetTag, BankType } from "~/services/bank";

const bank = (assetTag: AssetTag) =>
  ({ address: addr(), config: { assetTag } }) as unknown as BankType;

const holding = (held: AssetTag[]) => {
  const banks = held.map(bank);
  return {
    balances: banks.map((b) => ({ active: true, bankPk: b.address }) as BalanceType),
    bankMap: new Map(banks.map((b) => [b.address, b])),
    banks,
  };
};

describe("exceedsCostlyPositionLimit", () => {
  it("allows a 4th integration or staked position", () => {
    const { balances, bankMap } = holding([AssetTag.KAMINO, AssetTag.JUPLEND, AssetTag.STAKED]);
    expect(exceedsCostlyPositionLimit(balances, bankMap, bank(AssetTag.KAMINO))).toBe(false);
  });

  it("rejects a 5th, counting staked positions with integration ones", () => {
    const { balances, bankMap } = holding([
      AssetTag.KAMINO,
      AssetTag.DRIFT,
      AssetTag.STAKED,
      AssetTag.STAKED,
      AssetTag.DEFAULT,
    ]);
    expect(exceedsCostlyPositionLimit(balances, bankMap, bank(AssetTag.JUPLEND))).toBe(true);
  });

  it("allows topping up an existing position or opening a default one at the limit", () => {
    const { balances, bankMap, banks } = holding([
      AssetTag.KAMINO,
      AssetTag.KAMINO,
      AssetTag.KAMINO,
      AssetTag.KAMINO,
    ]);
    expect(exceedsCostlyPositionLimit(balances, bankMap, banks[0])).toBe(false);
    expect(exceedsCostlyPositionLimit(balances, bankMap, bank(AssetTag.DEFAULT))).toBe(false);
  });
});

describe("isWholePosition", () => {
  it("counts an already-rounded debt as whole", () => {
    // 2.007 * 10 ** 6 is 2007000.0000000002 in floating point
    expect(computeClosePositionTokenAmount({ amount: 2.007, isLending: false }, 6)).toBe(2.007);
    expect(isWholePosition({ amount: 2.007, isLending: false }, 2.007, 6)).toBe(true);
  });

  it("doesn't count a withdraw one native unit short as whole", () => {
    // 1.001 * 10 ** 6 is 1000999.9999999999 in floating point
    expect(computeClosePositionTokenAmount({ amount: 1.001, isLending: true }, 6)).toBe(1.001);
    expect(isWholePosition({ amount: 1.001, isLending: true }, 1.000999, 6)).toBe(false);
  });
});

describe("resolveOrderLegs", () => {
  const bankA = key(1);
  const bankB = key(2);
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
    ({ address: key(3), balances, activeOrders: 1 }) as unknown as MarginfiAccountType;

  it("maps the tagged balances to collateral and debt", () => {
    const account = accountWith([
      balance(bankA, 3, { assets: 10 }),
      balance(bankB, 4, { liabilities: 5 }),
    ]);
    expect(resolveOrderLegs(account, { tags: [4, 3] })).toEqual({
      collateralBank: bankA,
      debtBank: bankB,
    });
  });

  it("ignores dust liability shares left on the collateral balance", () => {
    const account = accountWith([
      balance(bankA, 3, { assets: 10, liabilities: 0.5 }),
      balance(bankB, 4, { liabilities: 5 }),
    ]);
    expect(resolveOrderLegs(account, { tags: [3, 4] })).toEqual({
      collateralBank: bankA,
      debtBank: bankB,
    });
  });

  it("returns null for a closed leg", () => {
    const account = accountWith([balance(bankA, 3, { assets: 10 })]);
    expect(resolveOrderLegs(account, { tags: [3, 4] })).toEqual({
      collateralBank: bankA,
      debtBank: null,
    });
  });
});
