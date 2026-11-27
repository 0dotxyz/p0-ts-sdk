import {
  AccountRole,
  address,
  getAddressEncoder,
  getBase64Decoder,
  isSignerRole,
  isWritableRole,
  type Address,
  type Instruction,
} from "@solana/kit";
import { describe, expect, it } from "vitest";

import { key } from "../../helpers/addresses";

import { buildSwapQuoteResult, deserializeSerializedInstruction } from "~/vendor/titan";

// Recorded from the web3.js implementation this replaced; never update with `-u`.

const jito = address("jitodontfronttitanspzero1111111111111111111");
const toWire = (built: Instruction) => ({
  programId: built.programAddress,
  keys: (built.accounts ?? []).map((a) => [
    a.address,
    isSignerRole(a.role),
    isWritableRole(a.role),
  ]),
  data: Buffer.from(built.data ?? []).toString("hex"),
});

const ix: Instruction = {
  programAddress: key(1),
  accounts: [
    { address: key(2), role: AccountRole.WRITABLE_SIGNER },
    { address: key(3), role: AccountRole.WRITABLE },
    { address: key(4), role: AccountRole.READONLY_SIGNER },
    { address: key(5), role: AccountRole.READONLY },
    { address: jito, role: AccountRole.READONLY },
  ],
  data: new Uint8Array([2, 1, 2, 3, 4]),
};

describe("titan wire format", () => {
  it("deserializes a proxy (base64) instruction without the jitodontfront marker", () => {
    const b64 = (value: Address) => getBase64Decoder().decode(getAddressEncoder().encode(value));
    const serialized = {
      p: b64(ix.programAddress),
      a: (ix.accounts ?? []).map((a) => ({
        p: b64(a.address),
        s: isSignerRole(a.role),
        w: isWritableRole(a.role),
      })),
      d: getBase64Decoder().decode(ix.data ?? new Uint8Array()),
    };
    expect(toWire(deserializeSerializedInstruction(serialized))).toMatchSnapshot();
  });
});

describe("buildSwapQuoteResult", () => {
  it.each([
    ["ExactIn", 100, 100, 1700, "83"],
    ["ExactOut", 100, 100, 1000, "110"],
    ["ExactIn", 999, 101, 100, "99"],
    ["ExactOut", 101, 999, 100, "103"],
    ["ExactIn", 999, 10000, 0.5, "9999"],
    ["ExactOut", 10000, 999, 0.5, "10001"],
    ["ExactIn", 9007199254740993n, 9007199254740993n, 0, "9007199254740993"],
    ["ExactOut", 9007199254740993n, 9007199254740993n, 0, "9007199254740993"],
    ["ExactIn", 18446744073709551615n, 18446744073709551615n, 50, "18354510353341003856"],
    ["ExactOut", 18446744073709551615n, 18446744073709551615n, 50, "18538977794078099374"],
  ] as const)(
    "computes the %s threshold for %s / %s at %s bps",
    (swapMode, inAmount, outAmount, slippageBps, threshold) => {
      const result = buildSwapQuoteResult({ inAmount, outAmount, slippageBps }, swapMode);
      expect(result.otherAmountThreshold).toBe(threshold);
      expect(result.inAmount).toBe(String(inAmount));
      expect(result.outAmount).toBe(String(outAmount));
    }
  );
});
