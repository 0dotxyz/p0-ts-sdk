import { AnchorProvider, BorshCoder, Program, Wallet } from "@coral-xyz/anchor";
import { Connection, PublicKey } from "@solana/web3.js";
import { describe, expect, it } from "vitest";

import { MARGINFI_IDL, MarginfiIdlType } from "~/idl";
import { MarginfiGroup } from "~/models/group";
import { MarginfiGroupRaw } from "~/services/group";
import { AccountType } from "~/types";

const U32_MAX = 0xffffffff;
// Anchor's Program camelCases the IDL; that's the IDL the SDK's decoders expect.
const camelIdl = new Program<MarginfiIdlType>(
  MARGINFI_IDL,
  new AnchorProvider(new Connection("http://127.0.0.1:1"), {} as Wallet, {})
).idl;
const coder = new BorshCoder(camelIdl);

// An all-zero group account with the right discriminator (no premium table configured).
const zeroedGroupData = (() => {
  const account = camelIdl.accounts.find((a) => a.name === AccountType.MarginfiGroup);
  const data = Buffer.alloc(coder.accounts.size(AccountType.MarginfiGroup));
  Buffer.from(account?.discriminator ?? []).copy(data);
  return data;
})();

describe("MarginfiGroup premium table decoding", () => {
  const address = PublicKey.unique();

  it("keeps the live entries (the first entryCount) with rates as APR fractions", () => {
    const raw: MarginfiGroupRaw = coder.accounts.decode(AccountType.MarginfiGroup, zeroedGroupData);
    raw.premiumSettings.entryCount = 2;
    [
      [2, 1, 0.05],
      [4, 1, 0.5],
      [9, 9, 0.9],
    ].forEach(([collateralTag, liabilityTag, rate], i) => {
      raw.premiumEntries[i] = {
        collateralTag,
        liabilityTag,
        rate: Math.round((rate * U32_MAX) / 10),
      };
    });

    const group = MarginfiGroup.fromAccountParsed(address, raw);

    expect(group.premiumEntries.map((e) => [e.collateralTag, e.liabilityTag])).toEqual([
      [2, 1],
      [4, 1],
    ]);
    expect(group.premiumEntries[0].rate.toNumber()).toBeCloseTo(0.05, 8);
    expect(group.premiumEntries[1].rate.toNumber()).toBeCloseTo(0.5, 8);
  });

  it("decodes raw account data with the camelCase IDL", () => {
    const group = MarginfiGroup.fromBuffer(address, zeroedGroupData, camelIdl);
    expect(group.premiumEntries).toEqual([]);
  });

  it("throws instead of returning an empty table when given the snake_case JSON IDL", () => {
    expect(() => MarginfiGroup.fromBuffer(address, zeroedGroupData, MARGINFI_IDL)).toThrow();
  });
});
