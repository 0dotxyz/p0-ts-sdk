import {
  getBase16Decoder,
  isSignerRole,
  isWritableRole,
  type Address,
  type GetAccountInfoApi,
  type Instruction,
  type Rpc,
} from "@solana/kit";

import fixture from "../fixtures/mainnet-vaults.json";

const accounts = fixture.accounts as Record<
  string,
  { data: string; owner: string; lamports: number; executable: boolean } | null
>;

// Serves the recorded vault accounts; every other account doesn't exist
export const vaultsRpc = {
  getAccountInfo: (a: Address) => ({
    send: async () => {
      const account = accounts[a];
      return {
        context: { slot: 1n },
        value: account
          ? {
              data: [account.data, "base64"],
              owner: account.owner,
              lamports: BigInt(account.lamports),
              executable: account.executable,
              space: BigInt(Buffer.from(account.data, "base64").length),
            }
          : null,
      };
    },
  }),
} as unknown as Rpc<GetAccountInfoApi>;

export const toVaultWire = (ixs: Instruction[]) =>
  ixs.map((ix) => ({
    program: ix.programAddress,
    accounts: (ix.accounts ?? []).map((m) => [
      m.address,
      isSignerRole(m.role),
      isWritableRole(m.role),
    ]),
    data: getBase16Decoder().decode(ix.data ?? new Uint8Array()),
  }));
