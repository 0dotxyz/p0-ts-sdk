import {
  AccountRole,
  blockhash,
  compileTransactionMessage,
  createNoopSigner,
  getAddressDecoder,
  type Instruction,
} from "@solana/kit";
import { describe, expect, it } from "vitest";

import { composeBridgedSwap } from "~/services/account/actions/bridge-swap";
import type { MarginfiAccountType, SwapQuoteResult } from "~/services/account/types";
import { makeTransactionMessage } from "~/services/transaction/helpers/tx-formatting";
import { TransactionType } from "~/services/transaction/types";

const key = (fill: number) => getAddressDecoder().decode(new Uint8Array(32).fill(fill));
const feePayer = createNoopSigner(key(1));
const latestBlockhash = {
  blockhash: blockhash("EETubP5AKHgjPAhzPAFcb8BAY1hMH639CWCFTqi3hq1k"),
  lastValidBlockHeight: 0n,
};
const setupProgram = key(200);
const lookupTable = key(100);
const quoteResponse: SwapQuoteResult = {
  inAmount: "1",
  outAmount: "1",
  otherAmountThreshold: "1",
  slippageBps: 0,
};

/** A setup instruction: one writable account at `firstKey`, then two read-only accounts. */
const setupIx = (firstKey: number): Instruction => ({
  programAddress: setupProgram,
  accounts: [
    { address: key(firstKey), role: AccountRole.WRITABLE },
    { address: key(firstKey + 1), role: AccountRole.READONLY },
    { address: key(firstKey + 2), role: AccountRole.READONLY },
  ],
  data: new Uint8Array([1]),
});

// Both legs' accounts are in the lookup table, so a version 0 leg's instruction carries
// lookup-table account metas (a version 1 leg has no table).
const luts = { [lookupTable]: [10, 11, 12, 20, 21, 22].map(key) };

// The setup program + the two read-only accounts of each leg.
const READONLY_ACCOUNTS = 5;

/** A leg whose only transaction is the setup transaction for `setupIx(firstKey)`. */
const setupLeg = (firstKey: number, version: 0 | 1) => ({
  transactions: [
    {
      message: makeTransactionMessage({
        instructions: [setupIx(firstKey)],
        feePayer,
        latestBlockhash,
        txFormat: version === 1 ? { version: 1 } : { version: 0, luts },
      }),
      type: TransactionType.CREATE_ATA,
    },
  ],
  quoteResponse,
});

/** The merged setup message of a bridged swap whose legs were built with the given versions. */
async function mergeSetups(firstVersion: 0 | 1, secondVersion: 0 | 1) {
  const result = await composeBridgedSwap({
    firstLeg: setupLeg(10, firstVersion),
    buildSecondLeg: async () => setupLeg(20, secondVersion),
    marginfiAccount: { balances: [] } as unknown as MarginfiAccountType,
    programAddress: key(201),
    banksMap: new Map(),
    assetShareValueMultiplierByBank: new Map(),
    feePayer,
  });

  const transactions = result?.transactions ?? [];
  expect(transactions).toHaveLength(1);
  expect(transactions[0].type).toBe(TransactionType.CREATE_ATA);
  expect(transactions[0].message.instructions).toHaveLength(2);
  return transactions[0].message;
}

describe("bridged swap setup merge", () => {
  it("merges version 1 setup transactions into one version 1 transaction", async () => {
    const message = await mergeSetups(1, 1);

    expect(message.version).toBe(1);

    const compiled = compileTransactionMessage(message);
    expect("addressTableLookups" in compiled).toBe(false);
    expect(compiled.header.numReadonlyNonSignerAccounts).toBe(READONLY_ACCOUNTS);
  });

  it("merges version 0 setup transactions into one version 0 transaction", async () => {
    const message = await mergeSetups(0, 0);

    expect(message.version).toBe(0);
  });

  it("falls back to version 0 when the legs mix versions", async () => {
    const message = await mergeSetups(1, 0);

    expect(message.version).toBe(0);

    // The version 1 leg's accounts stay static, the version 0 leg's stay in the lookup table.
    const compiled = compileTransactionMessage(message);
    const lookups = "addressTableLookups" in compiled ? (compiled.addressTableLookups ?? []) : [];
    expect(lookups).toEqual([
      { lookupTableAddress: lookupTable, writableIndexes: [3], readonlyIndexes: [4, 5] },
    ]);
    // No read-only account is encoded as writable: the static and the looked-up ones add up.
    expect(
      compiled.header.numReadonlyNonSignerAccounts +
        lookups.flatMap((lookup) => lookup.readonlyIndexes).length
    ).toBe(READONLY_ACCOUNTS);
  });
});
