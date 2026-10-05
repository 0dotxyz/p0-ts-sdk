import { PublicKey } from "@solana/web3.js";
import { describe, expect, it } from "vitest";

import { BalanceType, exceedsCostlyPositionLimit } from "~/services/account";
import { AssetTag, BankType } from "~/services/bank";

const bank = (assetTag: AssetTag) =>
  ({ address: PublicKey.unique(), config: { assetTag } }) as unknown as BankType;

const holding = (held: AssetTag[]) => {
  const banks = held.map(bank);
  return {
    balances: banks.map((b) => ({ active: true, bankPk: b.address }) as BalanceType),
    bankMap: new Map(banks.map((b) => [b.address.toBase58(), b])),
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
