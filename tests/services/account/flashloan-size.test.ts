import { AccountRole, getAddressDecoder, type Instruction } from "@solana/kit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MAX_ACCOUNT_LOCKS, MAX_TX_SIZE } from "~/constants";
import { compileFlashloanPrecheck } from "~/services/account/utils/flashloan-size.utils";
import { TransactionFormat } from "~/services/transaction";

const key = (fill: number) => getAddressDecoder().decode(new Uint8Array(32).fill(fill));
const payer = key(1);
const programAddress = key(200);
const V1_SIZE_LIMIT = 4096;

/** An instruction touching `accounts` writable accounts starting at `firstKey`, with `dataLength` bytes. */
const ix = (firstKey: number, accounts: number, dataLength: number): Instruction => ({
  programAddress,
  accounts: Array.from({ length: accounts }, (_, i) => ({
    address: key(firstKey + i),
    role: AccountRole.WRITABLE,
  })),
  data: new Uint8Array(dataLength),
});

// 26 accounts (payer + program + 3 x 8) and 3 x 450 data bytes: roughly 2.3 KB compiled, so over
// the version 0 limit without lookup tables and well under the version 1 limit.
const allIxs = [ix(10, 8, 450), ix(30, 8, 450), ix(50, 8, 450)];
const precheck = (txFormat: TransactionFormat) =>
  compileFlashloanPrecheck({
    allIxs,
    payer,
    txFormat,
    sizeConstraint: 0,
    swapIxCount: 1,
    swapLutCount: 0,
  });

describe("compileFlashloanPrecheck", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("measures the overshoot against the 1232-byte limit for version 0", () => {
    const v0 = precheck({ version: 0, luts: {} });

    expect(v0.totalAccounts).toBe(26);
    expect(v0.totalAccounts).toBeLessThanOrEqual(MAX_ACCOUNT_LOCKS);
    expect(v0.fullTxSize).toBeGreaterThan(MAX_TX_SIZE);
    expect(v0.fullTxSize).toBeLessThan(V1_SIZE_LIMIT);
    expect(v0.overshoot).toBe(v0.fullTxSize - MAX_TX_SIZE);
    expect(v0.overshoot).toBeGreaterThan(0);
  });

  it("measures the overshoot against the 4096-byte limit for version 1", () => {
    const v1 = precheck({ version: 1 });

    expect(v1.totalAccounts).toBe(26);
    expect(v1.writableAccounts).toBe(25);
    expect(v1.fullTxSize).toBeGreaterThan(MAX_TX_SIZE);
    expect(v1.overshoot).toBe(v1.fullTxSize - V1_SIZE_LIMIT);
    expect(v1.overshoot).toBeLessThanOrEqual(0);
  });
});
