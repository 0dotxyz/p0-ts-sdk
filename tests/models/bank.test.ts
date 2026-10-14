import { AnchorProvider, Program, Wallet } from "@coral-xyz/anchor";
import { Connection, PublicKey } from "@solana/web3.js";
import { describe, expect, it } from "vitest";

import bankFixtures from "../fixtures/mainnet-banks.json";

import { MARGINFI_IDL, MarginfiIdlType } from "~/idl";
import { Bank } from "~/models/bank";
import { decodeBankRaw, parseBankRaw } from "~/services/bank/utils/deserialize.utils";

// Anchor's Program camelCases the IDL; that's the IDL the SDK's decoders expect.
const camelIdl = new Program<MarginfiIdlType>(
  MARGINFI_IDL,
  new AnchorProvider(new Connection("http://127.0.0.1:1"), {} as Wallet, {})
).idl;

const decoded = bankFixtures.map(({ label, address, data }) => {
  const bankAddress = new PublicKey(address);
  const buffer = Buffer.from(data, "base64");
  return {
    label,
    bankAddress,
    buffer,
    bankType: parseBankRaw(bankAddress, decodeBankRaw(buffer, camelIdl)),
  };
});

describe("Bank", () => {
  it.each(decoded)("keeps every decoded field for $label", ({ bankAddress, buffer, bankType }) => {
    expect(Bank.fromBankType(bankType)).toMatchObject(bankType);
    expect(Bank.fromBuffer(bankAddress, buffer, camelIdl)).toMatchObject(bankType);
  });
});
