import { address, createNoopSigner } from "@solana/kit";
import { describe, expect, it } from "vitest";

import { LATEST_BLOCKHASH } from "../../../helpers/addresses";

import { makeMergeStakeAccountsTx } from "~/services/native-stake";

const authority = createNoopSigner(address("5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9"));
const stakeAccount = address("CooLbbZy5Xmdt7DiHPQ3ss2uRXawnTXXVgpMS8E8jDzr");
const validator = address("mrgn4t2JabSgvGnrCaHXMvz8ocr4F52scsxJnkQMQsQ");

describe("makeMergeStakeAccountsTx", () => {
  it("merges the source stake account into the destination", async () => {
    const { message } = await makeMergeStakeAccountsTx({
      rpc: {} as never,
      txFormat: { version: 0, luts: {} },
      latestBlockhash: LATEST_BLOCKHASH,
      authority,
      sourceStakeAccount: stakeAccount,
      destinationStakeAccount: validator,
    });

    expect(message.instructions[0].accounts?.map((meta) => meta.address)).toEqual([
      validator,
      stakeAccount,
      authority.address,
    ]);
  });
});
