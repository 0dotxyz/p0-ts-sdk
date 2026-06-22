import { describe, it, expect } from "vitest";
import {
  AddressLookupTableAccount,
  Keypair,
  TransactionInstruction,
} from "@solana/web3.js";
import { decode } from "@msgpack/msgpack";

import {
  buildTitanTemplate,
  encodeTitanTemplate,
  deserializeTitanWireInstruction,
} from "~/vendor/titan/gateway";

describe("Titan V3 transactionTemplate encoder", () => {
  const programId = Keypair.generate().publicKey;
  const acct = Keypair.generate().publicKey;
  const ix = new TransactionInstruction({
    programId,
    keys: [{ pubkey: acct, isSigner: false, isWritable: true }],
    data: Buffer.from([2, 1, 2, 3, 4]),
  });
  const lutKey = Keypair.generate().publicKey;
  const lutAddr = Keypair.generate().publicKey;
  const lut = new AddressLookupTableAccount({
    key: lutKey,
    state: {
      deactivationSlot: BigInt("18446744073709551615"),
      lastExtendedSlot: 0,
      lastExtendedSlotStartIndex: 0,
      addresses: [lutAddr],
    },
  });

  it("encodes wire fields as raw bytes (i/a/m) and round-trips through msgpack", () => {
    const template = buildTitanTemplate({ instructions: [ix], luts: [lut] });
    const b64 = encodeTitanTemplate(template);
    const back = decode(Buffer.from(b64, "base64")) as {
      i: { p: Uint8Array; a: { p: Uint8Array; s: boolean; w: boolean }[]; d: Uint8Array }[];
      a: { p: Uint8Array; a: Uint8Array[] }[];
      m: unknown[];
    };

    expect(Object.keys(back).sort()).toEqual(["a", "i", "m"]);

    // instruction
    expect(Buffer.from(back.i[0].p).equals(programId.toBytes())).toBe(true);
    expect(Buffer.from(back.i[0].d).equals(Buffer.from([2, 1, 2, 3, 4]))).toBe(true);
    expect(Buffer.from(back.i[0].a[0].p).equals(acct.toBytes())).toBe(true);
    expect(back.i[0].a[0].w).toBe(true);
    expect(back.i[0].a[0].s).toBe(false);

    // alt (order-preserving, key + inner addresses)
    expect(Buffer.from(back.a[0].p).equals(lutKey.toBytes())).toBe(true);
    expect(Buffer.from(back.a[0].a[0]).equals(lutAddr.toBytes())).toBe(true);
  });

  it("deserializes a wire instruction back into a web3 TransactionInstruction", () => {
    const template = buildTitanTemplate({ instructions: [ix], luts: [] });
    const rebuilt = deserializeTitanWireInstruction(template.i[0]);
    expect(rebuilt.programId.equals(programId)).toBe(true);
    expect(rebuilt.data.equals(Buffer.from([2, 1, 2, 3, 4]))).toBe(true);
    expect(rebuilt.keys[0].pubkey.equals(acct)).toBe(true);
    expect(rebuilt.keys[0].isWritable).toBe(true);
  });

  it("preserves ALT order (load-bearing for greedy resolution)", () => {
    const lut2 = new AddressLookupTableAccount({
      key: Keypair.generate().publicKey,
      state: {
        deactivationSlot: BigInt("18446744073709551615"),
        lastExtendedSlot: 0,
        lastExtendedSlotStartIndex: 0,
        addresses: [Keypair.generate().publicKey],
      },
    });
    const template = buildTitanTemplate({ instructions: [], luts: [lut, lut2] });
    expect(Buffer.from(template.a[0].p).equals(lut.key.toBytes())).toBe(true);
    expect(Buffer.from(template.a[1].p).equals(lut2.key.toBytes())).toBe(true);
  });
});
