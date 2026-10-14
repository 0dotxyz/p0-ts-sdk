import {
  AccountRole,
  compileTransaction,
  compileTransactionMessage,
  createNoopSigner,
  getTransactionEncoder,
  type Instruction,
} from "@solana/kit";
import { describe, expect, it } from "vitest";

import { key, LATEST_BLOCKHASH } from "../../../helpers/addresses";

import { makeTransactionMessage } from "~/services/transaction/helpers/tx-formatting";
import { getTotalAccountKeys, getTxSize } from "~/services/transaction/helpers/tx-size";

const feePayer = createNoopSigner(key(1));
const latestBlockhash = LATEST_BLOCKHASH;
const programAddress = key(200);

// An instruction touching `accounts` read-only accounts starting at `firstKey`, with `dataLength` bytes
const ix = (firstKey: number, accounts: number, dataLength = 0): Instruction => ({
  programAddress,
  accounts: Array.from({ length: accounts }, (_, i) => ({
    address: key(firstKey + i),
    role: AccountRole.READONLY,
  })),
  data: new Uint8Array(dataLength),
});

const wireSize = (message: ReturnType<typeof makeTransactionMessage>) =>
  getTransactionEncoder().encode(compileTransaction(message)).length;

describe("getTxSize", () => {
  it("compresses lookup-table accounts and measures the exact wire size", () => {
    const plain = makeTransactionMessage({
      instructions: [ix(10, 4)],
      feePayer,
      latestBlockhash,
      txFormat: { version: 0, luts: {} },
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
      expect(getTxSize(message)).toBe(wireSize(message));
    }
    expect(getTxSize(compressed)).toBeLessThan(getTxSize(plain));
  });

  it("measures the exact wire size of a version 1 message", () => {
    const message = makeTransactionMessage({
      instructions: [ix(10, 4, 100), ix(20, 2, 7)],
      feePayer,
      latestBlockhash,
      txFormat: { version: 1 },
    });

    expect(getTxSize(message)).toBe(wireSize(message));
  });
});
