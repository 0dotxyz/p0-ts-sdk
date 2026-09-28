import { address, createNoopSigner, type Address } from "@solana/kit";
import { describe, expect, it, vi } from "vitest";

import { makeCreateAccountTxWithProjection } from "~/services/account/actions/account-lifecycle";
import { findRandomAvailableAccountIndex } from "~/services/account/utils/fetch.utils";
import { deriveMarginfiAccount } from "~/utils";

const programAddress = address("MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA");
const group = address("4qp6Fx6tnZkY5Wropq9wUYgtFxXKwE6viZxFHg3rdAG8");
const authority = createNoopSigner(address("EwLiQ3MzGEUeRqtyYsqUtaZFgCkiDA9gLBxFjbGDCbhT"));
const takenAccount = {
  data: ["", "base64"],
  executable: false,
  lamports: 1n,
  owner: programAddress,
  space: 0n,
};

// Every candidate PDA exists except those at `freePositions` of each batch.
const mockRpc = (freePositions: number[]) => ({
  getLatestBlockhash: () => ({
    send: async () => ({
      value: { blockhash: "EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N", lastValidBlockHeight: 1n },
    }),
  }),
  getMultipleAccounts: vi.fn((addresses: Address[]) => ({
    send: async () => ({
      context: { slot: 1n },
      value: addresses.map((_, i) => (freePositions.includes(i) ? null : takenAccount)),
    }),
  })),
});

describe("create account index", () => {
  it("picks a free index once when accountIndex is omitted", async () => {
    const rpc = mockRpc([5]);
    const { account, tx } = await makeCreateAccountTxWithProjection({
      programAddress,
      authority,
      group,
      rpc: rpc as never,
      luts: {},
    });

    expect(rpc.getMultipleAccounts).toHaveBeenCalledTimes(1);
    const freeAddress = rpc.getMultipleAccounts.mock.calls[0][0][5];
    expect(account.address).toBe(freeAddress);
    expect(tx.message.instructions[0].accounts?.map((meta) => meta.address)).toContain(freeAddress);
  });

  it("uses the given accountIndex without RPC", async () => {
    const rpc = mockRpc([]);
    const { account } = await makeCreateAccountTxWithProjection({
      programAddress,
      authority,
      group,
      rpc: rpc as never,
      luts: {},
      accountIndex: 4,
      thirdPartyId: 7,
    });

    expect(rpc.getMultipleAccounts).not.toHaveBeenCalled();
    const [expected] = await deriveMarginfiAccount(programAddress, group, authority.address, 4, 7);
    expect(account.address).toBe(expected);
  });

  it("throws when every candidate is taken", async () => {
    const rpc = mockRpc([]);
    await expect(
      findRandomAvailableAccountIndex(rpc as never, programAddress, group, authority.address)
    ).rejects.toThrow("Unable to find free index");
    expect(rpc.getMultipleAccounts).toHaveBeenCalledTimes(8);
  });
});
