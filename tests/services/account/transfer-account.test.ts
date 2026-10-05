import { Keypair, PublicKey } from "@solana/web3.js";
import { describe, expect, it } from "vitest";

import {
  AccountFlags,
  makeAccountTransferToNewAccountTx,
  MarginfiAccountType,
} from "~/services/account";
import { MarginfiProgram } from "~/types";

describe("makeAccountTransferToNewAccountTx", () => {
  it("rejects a disabled account before touching the network", async () => {
    const marginfiAccount = {
      address: PublicKey.unique(),
      accountFlags: [AccountFlags.ACCOUNT_DISABLED],
    } as unknown as MarginfiAccountType;

    await expect(
      makeAccountTransferToNewAccountTx({
        connection: {} as never,
        program: {} as MarginfiProgram,
        marginfiAccount,
        newMarginfiAccount: Keypair.generate(),
        newAuthority: PublicKey.unique(),
      })
    ).rejects.toThrow(`Account ${marginfiAccount.address.toBase58()} is disabled`);
  });
});
