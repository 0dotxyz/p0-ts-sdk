import { AccountRole, compileTransaction, createNoopSigner } from "@solana/kit";
import { describe, expect, it, vi } from "vitest";

import { addr, LATEST_BLOCKHASH } from "../../../helpers/addresses";

import { makeTransactionMessage, simulateBundle } from "~/services/transaction";

const endpoint = "http://simulate.test";
const transaction = () =>
  compileTransaction(
    makeTransactionMessage({
      instructions: [
        {
          programAddress: addr(),
          accounts: [{ address: addr(), role: AccountRole.WRITABLE }],
          data: new Uint8Array([1]),
        },
      ],
      feePayer: createNoopSigner(addr()),
      latestBlockhash: LATEST_BLOCKHASH,
      txFormat: { version: 0, luts: {} },
    })
  );

type SimulateRequest = {
  method: string;
  params: [
    { encodedTransactions: string[] },
    { postExecutionAccountsConfigs: { addresses: string[] }[] },
  ];
};

function stubRpc(respond: () => Response) {
  const requests: SimulateRequest[] = [];
  vi.stubGlobal("fetch", async (_url: string, init: { body: string }) => {
    requests.push(JSON.parse(init.body));
    return respond();
  });
  return requests;
}
const rpcResult = (value: unknown) =>
  new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { context: { slot: 1 }, value } }));

describe("simulateBundle", () => {
  it("rejects an empty bundle", async () => {
    await expect(simulateBundle(endpoint, [])).rejects.toThrow("No bundle provided");
  });

  it("simulates every transaction and returns their results", async () => {
    const results = [{ logs: ["a"] }, { logs: ["b"] }];
    const requests = stubRpc(() =>
      rpcResult({ summary: "succeeded", transactionResults: results })
    );
    const account = addr();

    expect(await simulateBundle(endpoint, [transaction(), transaction()], [account])).toEqual(
      results
    );
    const [{ method, params }] = requests;
    expect(method).toBe("simulateBundle");
    expect(params[0].encodedTransactions).toHaveLength(2);
    expect(params[1].postExecutionAccountsConfigs).toEqual([
      { addresses: [] },
      { addresses: [account] },
    ]);
  });

  it("throws with the failure and every transaction's logs when the bundle fails", async () => {
    stubRpc(() =>
      rpcResult({
        summary: { failed: { error: { InstructionError: [0, "Custom"] } } },
        transactionResults: [{ logs: ["a"] }, { logs: ["b"] }],
      })
    );

    await expect(simulateBundle(endpoint, [transaction()])).rejects.toMatchObject({
      name: "BundleSimulationError",
      message: JSON.stringify({ InstructionError: [0, "Custom"] }),
      logs: ["a", "b"],
    });
  });

  it("throws with the HTTP status on a failed request", async () => {
    stubRpc(() => new Response("", { status: 503, statusText: "Service Unavailable" }));

    await expect(simulateBundle(endpoint, [transaction()])).rejects.toThrow(
      "HTTP error 503: Service Unavailable"
    );
  });

  it("keeps the RPC's error as the cause when the RPC answers with one", async () => {
    const error = { code: -32601, message: "Method not found" };
    stubRpc(() => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, error })));

    await expect(simulateBundle(endpoint, [transaction()])).rejects.toMatchObject({
      message: "Failed to execute bundle simulation",
      cause: error,
    });
  });
});
