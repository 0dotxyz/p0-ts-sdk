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

import { ADDRESS_LOOKUP_TABLE_FOR_GROUP_NATIVE_STAKE } from "~/constants";
import instructions from "~/instructions";
import { decodeBank } from "~/services/bank/utils/deserialize.utils";
import {
  isFlashloan,
  makeTransactionMessage,
  selectLutsForBanks,
  splitInstructionsToFitTransactions,
  withLookupTables,
} from "~/services/transaction/helpers/tx-formatting";
import { getTotalAccountKeys, getTxSize } from "~/services/transaction/helpers/tx-size";
import { TransactionFormat, TransactionType } from "~/services/transaction/types";

const key = (fill: number) => getAddressDecoder().decode(new Uint8Array(32).fill(fill));
const feePayer = createNoopSigner(key(1));
const latestBlockhash = {
  blockhash: blockhash("EETubP5AKHgjPAhzPAFcb8BAY1hMH639CWCFTqi3hq1k"),
  lastValidBlockHeight: 0n,
};
const programAddress = key(200);
const v0: TransactionFormat = { version: 0, luts: {} };
const v1: TransactionFormat = { version: 1 };

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
    decodeBank(address(bankAddress), getBase64Encoder().encode(data)),
  ])
);

describe("transaction messages", () => {
  it("compresses lookup-table accounts and measures the exact wire size", () => {
    const plain = makeTransactionMessage({
      instructions: [ix(10, 4)],
      feePayer,
      latestBlockhash,
      txFormat: v0,
    });
    const compressed = makeTransactionMessage({
      instructions: [ix(10, 4)],
      feePayer,
      latestBlockhash,
      txFormat: { version: 0, luts: { [key(100)]: [key(10), key(11)] } },
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
      txFormat: v0,
    });

    expect(messages.map((m) => m.instructions.length)).toEqual([3, 2]);
    expect(messages.every((m) => m.instructions[0] === mandatory)).toBe(true);
    expect(() =>
      splitInstructionsToFitTransactions([], [ix(20, 1, 1300)], {
        latestBlockhash,
        feePayer,
        txFormat: v0,
      })
    ).toThrow("Single instruction too large");
  });

  it("caps account locks per transaction", () => {
    const messages = splitInstructionsToFitTransactions([], [ix(10, 5), ix(20, 5), ix(30, 5)], {
      latestBlockhash,
      feePayer,
      txFormat: v0,
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
      message: makeTransactionMessage({
        instructions: ixs,
        feePayer,
        latestBlockhash,
        txFormat: v0,
      }),
      type: TransactionType.FLASHLOAN,
    });

    expect(isFlashloan(tx([ix(10, 1), begin]))).toBe(true);
    expect(isFlashloan(tx([ix(10, 1)]))).toBe(false);
  });
});

describe("version 1 transaction messages", () => {
  const V1_SIZE_LIMIT = 4096;
  const wireSize = (message: ReturnType<typeof makeTransactionMessage>) =>
    getTransactionEncoder().encode(compileTransaction(message)).length;

  it("keeps every account static and sets the default resource limits", () => {
    const message = makeTransactionMessage({
      instructions: [ix(10, 4)],
      feePayer,
      latestBlockhash,
      txFormat: v1,
    });

    expect(message.version).toBe(1);

    const compiled = compileTransactionMessage(message);
    expect(compiled.version).toBe(1);
    expect("addressTableLookups" in compiled).toBe(false);
    // fee payer + program + the 4 instruction accounts
    expect(new Set(compiled.staticAccounts)).toEqual(
      new Set([feePayer.address, programAddress, key(10), key(11), key(12), key(13)])
    );
    expect(compiled.staticAccounts).toHaveLength(6);
    expect(getTotalAccountKeys(message)).toBe(6);

    expect("config" in message && message.config).toEqual({
      computeUnitLimit: 1_400_000,
      loadedAccountsDataSizeLimit: 67_108_864,
      priorityFeeLamports: 0n,
    });
  });

  it("measures the exact wire size", () => {
    const message = makeTransactionMessage({
      instructions: [ix(10, 4, 100), ix(20, 2, 7)],
      feePayer,
      latestBlockhash,
      txFormat: v1,
    });

    expect(getTxSize(message)).toBe(wireSize(message));
  });

  it("fits a single instruction that is too large for version 0", () => {
    const large = ix(20, 1, 1300);
    const opts = { latestBlockhash, feePayer };

    expect(() =>
      splitInstructionsToFitTransactions([], [large], { ...opts, txFormat: v0 })
    ).toThrow("Single instruction too large");

    const messages = splitInstructionsToFitTransactions([], [large], { ...opts, txFormat: v1 });

    expect(messages).toHaveLength(1);
    expect(messages[0].version).toBe(1);
    expect(messages[0].instructions).toEqual([large]);
    expect(wireSize(messages[0])).toBeGreaterThan(1232);
    expect(wireSize(messages[0])).toBeLessThanOrEqual(V1_SIZE_LIMIT);
  });

  it("splits instructions against the 4096-byte limit", () => {
    // 5 x 1300 bytes of instruction data: over one version 1 message, under two
    const big = [10, 20, 30, 40, 50].map((firstKey) => ix(firstKey, 2, 1300));

    const messages = splitInstructionsToFitTransactions([], big, {
      latestBlockhash,
      feePayer,
      txFormat: v1,
    });

    expect(messages.length).toBeGreaterThan(1);
    expect(messages.flatMap((m) => m.instructions)).toEqual(big);
    for (const message of messages) {
      expect(message.version).toBe(1);
      expect(wireSize(message)).toBeLessThanOrEqual(V1_SIZE_LIMIT);
    }
  });
});

describe("selectLutsForBanks", () => {
  const nativeStakeLut = ADDRESS_LOOKUP_TABLE_FOR_GROUP_NATIVE_STAKE[banks.staked.group][0];
  const generalLut = key(150);
  const txFormat: TransactionFormat = {
    version: 0,
    luts: { [generalLut]: [key(10)], [nativeStakeLut]: [key(11)] },
  };

  it("uses the native-stake set when every bank is STAKED or SOL", () => {
    expect(selectLutsForBanks(txFormat, [banks.staked, banks.sol])).toEqual({
      version: 0,
      luts: { [nativeStakeLut]: [key(11)] },
    });
  });

  it("falls back to the general set otherwise", () => {
    expect(selectLutsForBanks(txFormat, [banks.staked, banks.default])).toEqual({
      version: 0,
      luts: { [generalLut]: [key(10)] },
    });
  });

  it("returns a version 1 format unchanged", () => {
    expect(selectLutsForBanks(v1, [banks.staked, banks.sol])).toBe(v1);
  });
});

describe("withLookupTables", () => {
  it("adds the tables to a version 0 format and leaves version 1 unchanged", () => {
    const routeLuts = { [key(160)]: [key(12)] };

    expect(withLookupTables({ version: 0, luts: { [key(150)]: [key(10)] } }, routeLuts)).toEqual({
      version: 0,
      luts: { [key(150)]: [key(10)], [key(160)]: [key(12)] },
    });
    expect(withLookupTables(v1, routeLuts)).toBe(v1);
  });
});
