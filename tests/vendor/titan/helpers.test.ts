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

import { deserializeSerializedInstruction } from "~/vendor/titan";

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
