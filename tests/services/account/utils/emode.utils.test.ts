import { type Address } from "@solana/kit";
import { BigNumber } from "bignumber.js";
import { describe, expect, it } from "vitest";

import { addr } from "../../../helpers/addresses";

import { MarginfiAccount } from "~/models/account";
import { createEmptyBalance, MarginfiAccountType } from "~/services/account";
import {
  computeActiveEmodePairs,
  computeEmodeImpacts,
  getEmodePairs,
} from "~/services/account/utils/emode.utils";
import { BankType, EmodeImpactStatus, EmodeTag } from "~/services/bank";

// `entries` maps a collateral tag to the initial weight it gets while this bank is borrowed
const bank = (emodeTag: EmodeTag, entries: [EmodeTag, number][] = []): BankType =>
  ({
    address: addr(),
    emode: {
      emodeTag,
      emodeEntries: entries.map(([collateralBankEmodeTag, weight]) => ({
        collateralBankEmodeTag,
        assetWeightInit: new BigNumber(weight),
        assetWeightMaint: new BigNumber(weight),
      })),
    },
  }) as unknown as BankType;

// Collateral
const sol = bank(EmodeTag.SOL);
const lst = bank(EmodeTag.LST_T1);
// Borrowed
const usdc = bank(EmodeTag.STABLE_T1, [[EmodeTag.SOL, 0.9]]);
const usdtNoSol = bank(EmodeTag.STABLE_T1, [[EmodeTag.LST_T1, 0.9]]);
const usdtLowSol = bank(EmodeTag.STABLE_T1, [[EmodeTag.SOL, 0.8]]);
const untagged = bank(EmodeTag.UNSET, [[EmodeTag.SOL, 0.9]]);
const pairs = getEmodePairs([sol, lst, usdc, usdtNoSol, usdtLowSol, untagged]);

describe("emode reconciliation", () => {
  it("boosts SOL collateral only if every borrowed bank has a SOL entry, not just one per tag", () => {
    // Borrowing USDC against SOL: boosted
    expect(computeActiveEmodePairs(pairs, [usdc.address], [sol.address])).toHaveLength(1);
    // Borrowing USDC and USDT (same tag, no SOL entry) against SOL: not boosted
    expect(
      computeActiveEmodePairs(pairs, [usdc.address, usdtNoSol.address], [sol.address])
    ).toEqual([]);
  });

  it("boosts each collateral on its own: holding LST doesn't take away SOL's boost", () => {
    const active = computeActiveEmodePairs(pairs, [usdc.address], [sol.address, lst.address]);
    expect(active.map((pair) => pair.collateralBankTag)).toEqual([EmodeTag.SOL]);
  });

  it("applies a borrowed bank's entries when its own tag is unset", () => {
    expect(computeActiveEmodePairs(pairs, [untagged.address], [sol.address])).toHaveLength(1);
  });

  it("reports borrowing USDT (lower SOL weight) next to USDC against SOL as a reduction", () => {
    const impacts = computeEmodeImpacts(pairs, [usdc.address], [sol.address], [usdtLowSol.address]);
    expect(impacts[usdtLowSol.address].borrowImpact?.status).toBe(EmodeImpactStatus.ReduceEmode);
  });

  it("ignores dust debt below one share, like the program", () => {
    const balance = (bankPk: Address, side: "assetShares" | "liabilityShares", shares: number) => ({
      ...createEmptyBalance(bankPk),
      active: true,
      [side]: new BigNumber(shares),
    });
    // Supplying SOL, borrowing USDC, with dust left in USDT (no SOL entry)
    const account = MarginfiAccount.fromAccountType({
      address: addr(),
      group: addr(),
      authority: addr(),
      balances: [
        balance(sol.address, "assetShares", 10),
        balance(usdc.address, "liabilityShares", 100),
        balance(usdtNoSol.address, "liabilityShares", 0.5),
      ],
      accountFlags: [],
      healthCache: {},
    } as unknown as MarginfiAccountType);
    expect(account.computeActiveEmodePairs(pairs)).toHaveLength(1);
  });
});
