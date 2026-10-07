import { address, createNoopSigner, isSignerRole, type Address } from "@solana/kit";
import { describe, expect, it, vi } from "vitest";

import { MAX_BALANCES } from "~/constants";
import { TransactionBuildingErrorCode } from "~/errors";
import {
  makeCloseAccountTx,
  makeCreateAccountTxWithProjection,
  makeTransferAccountIx,
} from "~/services/account/actions/account-lifecycle";
import { AccountFlags } from "~/services/account/types";
import { findRandomAvailableAccountIndex } from "~/services/account/utils/fetch.utils";
import { generateDummyMarginfiAccount } from "~/services/account/utils/transaction-projection.utils";
import { deriveFeeState, deriveMarginfiAccount } from "~/utils";

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
      txFormat: { version: 0, luts: {} },
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
      txFormat: { version: 0, luts: {} },
      accountIndex: 4,
      thirdPartyId: 7,
    });

    expect(rpc.getMultipleAccounts).not.toHaveBeenCalled();
    const [expected] = await deriveMarginfiAccount(programAddress, group, authority.address, 4, 7);
    expect(account.address).toBe(expected);
    expect(account.balances).toHaveLength(MAX_BALANCES);
    expect(account.balances.some((b) => b.active)).toBe(false);
  });

  it("throws when every candidate is taken", async () => {
    const rpc = mockRpc([]);
    await expect(
      findRandomAvailableAccountIndex(rpc as never, programAddress, group, authority.address)
    ).rejects.toThrow("Unable to find free index");
    expect(rpc.getMultipleAccounts).toHaveBeenCalledTimes(8);
  });
});

describe("close account", () => {
  const emptyAccount = generateDummyMarginfiAccount(
    group,
    authority.address,
    address("EwLiQoZdyJFVcxPnLmS6ow3LJVMD1yFLkD45c3PaPWRp")
  );
  const bank = address("2s37akK2eyBbp8DZgCm7RtsaEz8eJP3Nxd4urLHQv7yB");
  const close = (marginfiAccount: typeof emptyAccount) =>
    makeCloseAccountTx({
      programAddress,
      marginfiAccount,
      authority,
      rpc: mockRpc([]) as never,
      txFormat: { version: 0, luts: {} },
    });

  it("rejects an account with active balances", async () => {
    const withBalance = {
      ...emptyAccount,
      balances: emptyAccount.balances.map((b, i) =>
        i === 0 ? { ...b, active: true, bankPk: bank } : b
      ),
    };
    await expect(close(withBalance)).rejects.toMatchObject({
      code: TransactionBuildingErrorCode.ACCOUNT_NOT_EMPTY,
      details: { activeBanks: [bank] },
    });
  });

  it("rejects a disabled account", async () => {
    const disabled = { ...emptyAccount, accountFlags: [AccountFlags.ACCOUNT_DISABLED] };
    await expect(close(disabled)).rejects.toMatchObject({
      code: TransactionBuildingErrorCode.ACCOUNT_DISABLED,
    });
  });

  it("closes an empty account", async () => {
    const tx = await close(emptyAccount);
    expect(tx.message.instructions).toHaveLength(1);
  });
});

describe("transfer account", () => {
  it("creates the new account at the new authority's PDA, signed by the authority only", async () => {
    const newAuthority = address("11111111111111111111111111111114");
    const globalFeeWallet = address("11111111111111111111111111111113");
    const ix = await makeTransferAccountIx({
      programAddress,
      marginfiAccount: generateDummyMarginfiAccount(
        group,
        authority.address,
        address("EwLiQoZdyJFVcxPnLmS6ow3LJVMD1yFLkD45c3PaPWRp")
      ),
      authority,
      newAuthority,
      accountIndex: 2,
      thirdPartyId: 7,
      globalFeeWallet,
    });

    const metas = ix.accounts ?? [];
    const signers = metas.filter((meta) => isSignerRole(meta.role)).map((meta) => meta.address);
    expect(new Set(signers)).toEqual(new Set([authority.address]));
    const [newMarginfiAccount] = await deriveMarginfiAccount(
      programAddress,
      group,
      newAuthority,
      2,
      7
    );
    const [feeState] = await deriveFeeState(programAddress);
    expect(metas.map((meta) => meta.address)).toEqual(
      expect.arrayContaining([newMarginfiAccount, globalFeeWallet, feeState])
    );
  });
});
