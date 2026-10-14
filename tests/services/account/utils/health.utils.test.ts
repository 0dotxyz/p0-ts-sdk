import { BigNumber } from "bignumber.js";
import { describe, expect, it } from "vitest";

import { key } from "../../../helpers/addresses";

import { BalanceType, MarginRequirementType } from "~/services/account/types";
import { computeHealthComponentsFromBalances } from "~/services/account/utils/health.utils";
import { BankType } from "~/services/bank/types";

const bank = { address: key(1) } as unknown as BankType;
const balance = (side: "asset" | "liability"): BalanceType =>
  ({
    active: true,
    bankPk: bank.address,
    assetShares: new BigNumber(side === "asset" ? 10 : 0),
    liabilityShares: new BigNumber(side === "liability" ? 10 : 0),
  }) as unknown as BalanceType;

const health = (balances: BalanceType[], banksMap = new Map([[bank.address, bank]])) =>
  computeHealthComponentsFromBalances({
    activeBalances: balances,
    marginRequirement: MarginRequirementType.Initial,
    banksMap,
    oraclePricesByBank: new Map(),
  });

describe("computeHealthComponentsFromBalances", () => {
  it("fails on a liability without a price and counts an asset without one as 0", () => {
    expect(() => health([balance("liability")])).toThrow(/price/);
    expect(health([balance("asset")]).assets.toNumber()).toBe(0);
  });

  it("fails on a balance whose bank is missing", () => {
    expect(() => health([balance("asset")], new Map())).toThrow(/not found/);
  });
});
