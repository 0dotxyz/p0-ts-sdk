import { createNoopSigner, getAddressDecoder } from "@solana/kit";
import { describe, expect, it } from "vitest";

import instructions, { MarginfiInstruction, parseMarginfiIx } from "~/instructions";
import { isDepositIx, patchDepositAmount } from "~/services/account/utils/ix-patch.utils";

const key = (fill: number) => getAddressDecoder().decode(new Uint8Array(32).fill(fill));
const programAddress = key(200);
const accounts = {
  group: key(1),
  marginfiAccount: key(3),
  authority: createNoopSigner(key(2)),
  bank: key(4),
  liquidityVault: key(6),
  tokenProgram: key(7),
};

const deposit = () =>
  instructions.makeDepositIx(programAddress, {
    ...accounts,
    signerTokenAccount: key(5),
    amount: 1234n,
    depositUpToLimit: true,
  });

describe("deposit amount patching", () => {
  it("recognizes deposit instructions only", async () => {
    const withdraw = await instructions.makeWithdrawIx(programAddress, {
      ...accounts,
      destinationTokenAccount: key(5),
      amount: 1234n,
      withdrawAll: null,
    });

    expect(isDepositIx(await deposit())).toBe(true);
    expect(isDepositIx(withdraw)).toBe(false);
    expect(isDepositIx({ programAddress, data: new Uint8Array(16) })).toBe(false);
  });

  it("returns a copy with the new amount and leaves the rest untouched", async () => {
    const original = await deposit();
    const patched = patchDepositAmount(original, 987_654_321n);

    const parsed = parseMarginfiIx(patched);
    expect(parsed?.instructionType).toBe(MarginfiInstruction.LendingAccountDeposit);
    expect(parsed?.data).toMatchObject({ amount: 987_654_321n });
    expect(patched.accounts).toBe(original.accounts);
    expect(parseMarginfiIx(original)?.data).toMatchObject({ amount: 1234n });
  });

  it("refuses non-deposit instructions and negative amounts", async () => {
    const borrow = await instructions.makeBorrowIx(programAddress, {
      ...accounts,
      destinationTokenAccount: key(5),
      amount: 1n,
    });

    const depositIx = await deposit();

    expect(() => patchDepositAmount(borrow, 1n)).toThrow("not a known deposit");
    expect(() => patchDepositAmount(depositIx, -1n)).toThrow("non-negative");
  });
});
