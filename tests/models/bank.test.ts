import { address, getBase64Encoder } from "@solana/kit";
import { describe, expect, it } from "vitest";

import bankFixtures from "../fixtures/mainnet-banks.json";

import { Bank } from "~/models/bank";
import {
  computeBankBorrowApy,
  computeBankSupplyApy,
  isStandardBorrowable,
  isStandardDepositable,
} from "~/services/bank";
import { decodeBank } from "~/services/bank/utils/deserialize.utils";

const base64 = getBase64Encoder();
const decoded = bankFixtures.map(({ label, address: bankAddress, data }) => ({
  label,
  bankType: decodeBank(address(bankAddress), base64.encode(data)),
}));
const banks = decoded.map(({ label, bankType }) => ({ label, bank: Bank.fromBankType(bankType) }));

describe("Bank.fromBankType", () => {
  it.each(decoded)("keeps every decoded field for $label", ({ bankType }) => {
    expect(Bank.fromBankType(bankType)).toMatchObject(bankType);
  });
});

describe("Bank", () => {
  it.each(banks)("forwards APY and borrowability for $label", ({ bank }) => {
    expect(bank.computeSupplyApy()).toBe(computeBankSupplyApy(bank));
    expect(bank.computeBorrowApy()).toBe(computeBankBorrowApy(bank));
    expect(bank.computeBorrowApy()).toBeGreaterThanOrEqual(bank.computeSupplyApy());
    expect(bank.isStandardBorrowable).toBe(isStandardBorrowable(bank));
    expect(bank.isStandardDepositable).toBe(isStandardDepositable(bank));
  });
});
