import {
  address,
  createSolanaRpc,
  getBase64Encoder,
  getCompiledTransactionMessageDecoder,
  getTransactionDecoder,
} from "@solana/kit";
import BigNumber from "bignumber.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import bankFixtures from "../bank/fixtures/mainnet-banks.json";

import accountFixtures from "./fixtures/mainnet-accounts.json";

import { decodeBank, decodeMarginfiAccount } from "~/accounts";
import { simulateAccountHealthCache } from "~/services/account/services/account-simulation.service";
import { HealthCacheRaw, HealthCacheSimulationError } from "~/services/account/types";
import { parseMarginfiAccountRaw } from "~/services/account/utils/deserialize.utils";
import { parseBankRaw } from "~/services/bank/utils/deserialize.utils";
import { bigNumberToWrappedI80F48 } from "~/utils";

// The simulated post-execution account is the fixture itself, with `post.healthCache` applied.
const post = vi.hoisted(() => ({ healthCache: {} as Partial<HealthCacheRaw> }));
vi.mock("~/accounts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/accounts")>();
  return {
    ...actual,
    decodeMarginfiAccount: (data: Uint8Array) => {
      const account = actual.decodeMarginfiAccount(data);
      return { ...account, healthCache: { ...account.healthCache, ...post.healthCache } };
    },
  };
});

const base64 = getBase64Encoder();
const programAddress = address("MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA");
// Both the blockhash and the bundle simulation go through the stubbed `fetch`.
const rpcEndpoint = "http://simulate.test";
const rpc = createSolanaRpc(rpcEndpoint);

// Mainnet account with an asset in the default bank fixture and a liability in the SOL bank
// fixture; its other positions are dropped so every active bank is loaded.
const accountFixture = accountFixtures[1];
const banksMap = new Map(
  bankFixtures.map(({ address: bankAddress, data }) => [
    bankAddress,
    parseBankRaw(address(bankAddress), decodeBank(base64.encode(data))),
  ])
);
const parsed = parseMarginfiAccountRaw(
  address(accountFixture.address),
  decodeMarginfiAccount(base64.encode(accountFixture.data))
);
const marginfiAccount = {
  ...parsed,
  balances: parsed.balances.filter((balance) => banksMap.has(balance.bankPk)),
};

function decodeBundleTx(wireTransaction: string) {
  const { messageBytes } = getTransactionDecoder().decode(base64.encode(wireTransaction));
  const message = getCompiledTransactionMessageDecoder().decode(messageBytes);
  if (message.version !== 0) throw new Error("expected a v0 message");
  return {
    feePayer: message.staticAccounts[0],
    programs: message.instructions.map((ix) => message.staticAccounts[ix.programAddressIndex]),
  };
}

describe("simulateAccountHealthCache", () => {
  let request: { params: [{ encodedTransactions: string[] }, Record<string, unknown>] };

  beforeEach(() => {
    post.healthCache = {};
    vi.stubGlobal("fetch", async (_url: string, init: { body: string }) => {
      const body = JSON.parse(init.body);
      const respond = (value: unknown) =>
        new Response(
          JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { context: { slot: 1 }, value } })
        );
      if (body.method === "getLatestBlockhash") {
        return respond({
          blockhash: "EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N",
          lastValidBlockHeight: 100,
        });
      }
      request = body;
      const transactionResults = request.params[0].encodedTransactions.map((_, i, txs) => ({
        logs: [],
        postExecutionAccounts:
          i === txs.length - 1 ? [{ data: [accountFixture.data, "base64"] }] : [],
      }));
      return respond({ summary: "succeeded", transactionResults });
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  const simulate = () =>
    simulateAccountHealthCache({ rpc, rpcEndpoint, programAddress, banksMap, marginfiAccount });

  it("funds the authority, pulses health and returns the post-execution account", async () => {
    const simulated = await simulate();

    expect(simulated.lendingAccount).toEqual(
      decodeMarginfiAccount(base64.encode(accountFixture.data)).lendingAccount
    );
    expect(request.params[0].encodedTransactions.map(decodeBundleTx)).toEqual([
      {
        feePayer: marginfiAccount.authority,
        programs: [
          "ComputeBudget111111111111111111111111111111",
          "11111111111111111111111111111111",
        ],
      },
      {
        feePayer: marginfiAccount.authority,
        programs: ["ComputeBudget111111111111111111111111111111", programAddress],
      },
    ]);
    expect(request.params[1].postExecutionAccountsConfigs).toEqual([
      { addresses: [] },
      { addresses: [marginfiAccount.address] },
    ]);
  });

  it("accepts mrgnErr 6009 only when every health value is set", async () => {
    const one = bigNumberToWrappedI80F48(new BigNumber(1));
    post.healthCache = {
      mrgnErr: 6009,
      assetValue: one,
      liabilityValue: one,
      assetValueMaint: one,
      liabilityValueMaint: one,
      assetValueEquity: one,
      liabilityValueEquity: one,
    };
    await expect(simulate()).resolves.toMatchObject({ healthCache: { mrgnErr: 6009 } });

    post.healthCache.liabilityValueEquity = bigNumberToWrappedI80F48(new BigNumber(0));
    await expect(simulate()).rejects.toBeInstanceOf(HealthCacheSimulationError);
  });

  it("throws HealthCacheSimulationError on any other health-cache error", async () => {
    post.healthCache = { mrgnErr: 6010, internalErr: 3 };

    const error = await simulate().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HealthCacheSimulationError);
    expect(error).toMatchObject({ mrgnErr: 6010, internalErr: 3 });
  });
});
