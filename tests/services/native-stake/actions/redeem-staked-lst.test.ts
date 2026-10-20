import { address, createNoopSigner } from "@solana/kit";
import { SYSTEM_PROGRAM_ADDRESS } from "@solana-program/system";
import { TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { describe, expect, it } from "vitest";

import { makeRedeemStakedLstIx } from "~/services/native-stake";
import { SINGLE_POOL_PROGRAM_ADDRESS } from "~/vendor/single-spl-pool";

const authority = createNoopSigner(address("5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9"));
const validator = address("mrgn4t2JabSgvGnrCaHXMvz8ocr4F52scsxJnkQMQsQ");
const rpc = {
  getMinimumBalanceForRentExemption: () => ({ send: async () => 2_282_880n }),
} as never;

describe("makeRedeemStakedLstIx", () => {
  it("redeems LST into a new stake account", async () => {
    const ixs = await makeRedeemStakedLstIx({ rpc, amount: 2.5, authority, validator });

    expect(ixs.map((ix) => ix.programAddress)).toEqual([
      SYSTEM_PROGRAM_ADDRESS,
      TOKEN_PROGRAM_ADDRESS,
      SINGLE_POOL_PROGRAM_ADDRESS,
    ]);
    // approve and withdraw both use the native LST amount
    expect(ixs[1].data?.slice(1)).toEqual(new Uint8Array([0, 249, 2, 149, 0, 0, 0, 0]));
  });
});
