import { address, createNoopSigner } from "@solana/kit";
import { describe, expect, it } from "vitest";

import {
  AccountFlags,
  makeAccountTransferToNewAccountTx,
  MarginfiAccountType,
} from "~/services/account";

describe("makeAccountTransferToNewAccountTx", () => {
  it("rejects a disabled account before touching the network", async () => {
    const marginfiAccount = {
      address: address("EwLiQoZdyJFVcxPnLmS6ow3LJVMD1yFLkD45c3PaPWRp"),
      accountFlags: [AccountFlags.ACCOUNT_DISABLED],
    } as unknown as MarginfiAccountType;

    await expect(
      makeAccountTransferToNewAccountTx({
        rpc: {} as never,
        txFormat: { version: 0, luts: {} },
        programAddress: address("MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA"),
        marginfiAccount,
        authority: createNoopSigner(address("Fa7LNzj3SCV364hya9dx9evL29pC1awx24iHeCEwX6vU")),
        newMarginfiAccount: createNoopSigner(address("11111111111111111111111111111112")),
        newAuthority: address("11111111111111111111111111111113"),
      })
    ).rejects.toThrow(`Account ${marginfiAccount.address} is disabled`);
  });
});
