import {
  AccountRole,
  address,
  blockhash,
  compileTransaction,
  compileTransactionMessage,
  createNoopSigner,
  getAddressDecoder,
  getBase64Encoder,
  getTransactionEncoder,
  type Instruction,
} from "@solana/kit";
import { describe, expect, it } from "vitest";

import bankFixtures from "../bank/fixtures/mainnet-banks.json";

import { decodeBank } from "~/accounts";
import { ADDRESS_LOOKUP_TABLE_FOR_GROUP_NATIVE_STAKE } from "~/constants";
import instructions from "~/instructions";
import { parseBankRaw } from "~/services/bank/utils/deserialize.utils";
import {
  isFlashloan,
  makeTransactionMessage,
  selectLutsForBanks,
  splitInstructionsToFitTransactions,
} from "~/services/transaction/helpers/tx-formatting";
import { getTotalAccountKeys, getTxSize } from "~/services/transaction/helpers/tx-size";
import { TransactionType } from "~/services/transaction/types";

const key = (fill: number) => getAddressDecoder().decode(new Uint8Array(32).fill(fill));
const feePayer = createNoopSigner(key(1));
const latestBlockhash = {
  blockhash: blockhash("EETubP5AKHgjPAhzPAFcb8BAY1hMH639CWCFTqi3hq1k"),
  lastValidBlockHeight: 0n,
};
const programAddress = key(200);

/** An instruction touching `accounts` read-only accounts starting at `firstKey`, with `dataLength` bytes. */
const ix = (firstKey: number, accounts: number, dataLength = 0): Instruction => ({
  programAddress,
  accounts: Array.from({ length: accounts }, (_, i) => ({
    address: key(firstKey + i),
    role: AccountRole.READONLY,
  })),
  data: new Uint8Array(dataLength),
});

const banks = Object.fromEntries(
  bankFixtures.map(({ label, address: bankAddress, data }) => [
    label.split(" ")[0],
    parseBankRaw(address(bankAddress), decodeBank(getBase64Encoder().encode(data))),
  ])
);

describe("transaction messages", () => {
  it("compresses lookup-table accounts and measures the exact wire size", () => {
    const plain = makeTransactionMessage({ instructions: [ix(10, 4)], feePayer, latestBlockhash });
    const compressed = makeTransactionMessage({
      instructions: [ix(10, 4)],
      feePayer,
      latestBlockhash,
      luts: { [key(100)]: [key(10), key(11)] },
    });

    const lookups = compileTransactionMessage(compressed);
    expect("addressTableLookups" in lookups && lookups.addressTableLookups).toEqual([
      { lookupTableAddress: key(100), writableIndexes: [], readonlyIndexes: [0, 1] },
    ]);
    expect(getTotalAccountKeys(plain)).toBe(getTotalAccountKeys(compressed));
    for (const message of [plain, compressed]) {
      const wireSize = getTransactionEncoder().encode(compileTransaction(message)).length;
      expect(getTxSize(message)).toBe(wireSize);
    }
    expect(getTxSize(compressed)).toBeLessThan(getTxSize(plain));
  });

  it("splits instructions by size, keeping the mandatory ones in every transaction", () => {
    const mandatory = ix(10, 1);
    const big = [ix(20, 2, 400), ix(30, 2, 400), ix(40, 2, 400)];

    const messages = splitInstructionsToFitTransactions([mandatory], big, {
      latestBlockhash,
      feePayer,
      luts: {},
    });

    expect(messages.map((m) => m.instructions.length)).toEqual([3, 2]);
    expect(messages.every((m) => m.instructions[0] === mandatory)).toBe(true);
    expect(() =>
      splitInstructionsToFitTransactions([], [ix(20, 1, 1300)], {
        latestBlockhash,
        feePayer,
        luts: {},
      })
    ).toThrow("Single instruction too large");
  });

  it("caps account locks per transaction", () => {
    const messages = splitInstructionsToFitTransactions([], [ix(10, 5), ix(20, 5), ix(30, 5)], {
      latestBlockhash,
      feePayer,
      luts: {},
      maxAccountLocks: 13,
    });

    // fee payer + program + 5 accounts per instruction
    expect(messages.map(getTotalAccountKeys)).toEqual([12, 7]);
  });

  it("detects marginfi flashloans", async () => {
    const begin = await instructions.makeBeginFlashLoanIx(programAddress, {
      marginfiAccount: key(3),
      authority: feePayer,
      endIndex: 2n,
    });
    const tx = (ixs: Instruction[]) => ({
      message: makeTransactionMessage({ instructions: ixs, feePayer, latestBlockhash }),
      type: TransactionType.FLASHLOAN,
    });

    expect(isFlashloan(tx([ix(10, 1), begin]))).toBe(true);
    expect(isFlashloan(tx([ix(10, 1)]))).toBe(false);
  });
});

describe("selectLutsForBanks", () => {
  const nativeStakeLut = ADDRESS_LOOKUP_TABLE_FOR_GROUP_NATIVE_STAKE[banks.staked.group][0];
  const generalLut = key(150);
  const luts = { [generalLut]: [key(10)], [nativeStakeLut]: [key(11)] };

  it("uses the native-stake set when every bank is STAKED or SOL", () => {
    expect(Object.keys(selectLutsForBanks(luts, [banks.staked, banks.sol]))).toEqual([
      nativeStakeLut,
    ]);
  });

  it("falls back to the general set otherwise", () => {
    expect(Object.keys(selectLutsForBanks(luts, [banks.staked, banks.default]))).toEqual([
      generalLut,
    ]);
  });
});
