import {
  createSolanaRpc,
  type Address,
  type GetAccountInfoApi,
  type GetLatestBlockhashApi,
  type GetMultipleAccountsApi,
  type Rpc,
} from "@solana/kit";
import { vi } from "vitest";

import { LATEST_BLOCKHASH } from "./addresses";

type BuilderRpc = Rpc<GetAccountInfoApi & GetLatestBlockhashApi & GetMultipleAccountsApi>;

// An RPC whose blockhash is LATEST_BLOCKHASH and on which every account either exists (empty data)
// or doesn't; for builders that only fetch a blockhash and check token accounts exist
export function fakeRpc({ accountsExist }: { accountsExist: boolean }): BuilderRpc {
  const account = accountsExist ? { data: ["", "base64"] } : null;
  return {
    getLatestBlockhash: () => ({ send: async () => ({ value: LATEST_BLOCKHASH }) }),
    getAccountInfo: () => ({ send: async () => ({ context: { slot: 1n }, value: account }) }),
    getMultipleAccounts: (addresses: Address[]) => ({
      send: async () => ({ context: { slot: 1n }, value: addresses.map(() => account) }),
    }),
  } as unknown as BuilderRpc;
}

// A real Kit RPC, for code that serializes its requests (e.g. through a swap engine runner); its
// answers come from stubRpcFetch
export const stubbedRpc = createSolanaRpc("http://rpc.test");

// Answers getLatestBlockhash with LATEST_BLOCKHASH and reports every account in getMultipleAccounts
// missing. vitest.config.ts unstubs globals after each test.
export function stubRpcFetch() {
  vi.stubGlobal("fetch", async (_url: string, init: { body: string }) => {
    const { id, method, params } = JSON.parse(init.body);
    const value =
      method === "getLatestBlockhash"
        ? { blockhash: LATEST_BLOCKHASH.blockhash, lastValidBlockHeight: 100 }
        : params[0].map(() => null);
    return new Response(
      JSON.stringify({ jsonrpc: "2.0", id, result: { context: { slot: 1 }, value } })
    );
  });
}
