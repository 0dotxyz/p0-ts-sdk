import {
  address,
  createNoopSigner,
  createSolanaRpc,
  getAddressDecoder,
  getBase64Encoder,
  unwrapOption,
} from "@solana/kit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import bankFixtures from "../../bank/fixtures/mainnet-banks.json";
import accountFixtures from "../fixtures/mainnet-accounts.json";

import { MarginfiInstruction, parseMarginfiIx } from "~/instructions";
import { makeSwapDebtTx } from "~/services/account/actions/swap-debt";
import { SwapProvider } from "~/services/account/types";
import { decodeMarginfiAccount } from "~/services/account/utils/deserialize.utils";
import { decodeBank } from "~/services/bank/utils/deserialize.utils";

const base64 = getBase64Encoder();
const programAddress = address("MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA");
const tokenProgram = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const swapProgram = address("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4");

// Mainnet account with a liability in the SOL bank fixture, swapped into debt on a copy of that
// bank under another address and mint; its other positions are dropped so every active bank is
// loaded
const banks = Object.fromEntries(
  bankFixtures.map(({ label, address: bankAddress, data }) => [
    label.split(" ")[0],
    decodeBank(address(bankAddress), base64.encode(data)),
  ])
);
const borrowBank = {
  ...banks.sol,
  address: getAddressDecoder().decode(new Uint8Array(32).fill(7)),
  mint: getAddressDecoder().decode(new Uint8Array(32).fill(8)),
  mintDecimals: 6,
};
const bankMap = new Map([...Object.values(banks), borrowBank].map((bank) => [bank.address, bank]));
const parsed = decodeMarginfiAccount(
  address(accountFixtures[1].address),
  base64.encode(accountFixtures[1].data)
);
const marginfiAccount = {
  ...parsed,
  balances: parsed.balances.filter((balance) => !balance.active || bankMap.has(balance.bankPk)),
};

describe("makeSwapDebtTx", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", async (_url: string, init: { body: string }) => {
      const { id, method, params } = JSON.parse(init.body);
      const value =
        method === "getLatestBlockhash"
          ? { blockhash: "EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N", lastValidBlockHeight: 100 }
          : params[0].map(() => null);
      return new Response(
        JSON.stringify({ jsonrpc: "2.0", id, result: { context: { slot: 1 }, value } })
      );
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("repays all of a debt that isn't a whole number of native units", async () => {
    const result = await makeSwapDebtTx({
      programAddress,
      marginfiAccount,
      authority: createNoopSigner(marginfiAccount.authority),
      rpc: createSolanaRpc("http://swap-debt.test"),
      bankMap,
      bankMetadataMap: {},
      assetShareValueMultiplierByBank: new Map(),
      repayOpts: {
        repayBank: banks.sol,
        tokenProgram,
        totalPositionAmount: 0.123456789123,
        marketPrice: 150,
      },
      borrowOpts: { borrowBank, tokenProgram, marketPrice: 1 },
      swapOpts: {},
      txFormat: { version: 0, luts: {} },
      swapEngineRunner: async () => ({
        swapInstructions: [{ programAddress: swapProgram, accounts: [], data: new Uint8Array([1]) }],
        setupInstructions: [],
        swapLuts: {},
        quoteResponse: {
          inAmount: "18700000",
          outAmount: "124000000",
          otherAmountThreshold: "123400000",
          slippageBps: 50,
        },
        outputAmountNative: 123_400_000n,
        provider: SwapProvider.JUPITER,
      }),
    });

    const repay = result.transactions[result.actionTxIndex].message.instructions
      .map(parseMarginfiIx)
      .find((ix) => ix?.instructionType === MarginfiInstruction.LendingAccountRepay);
    if (repay?.instructionType !== MarginfiInstruction.LendingAccountRepay) {
      throw new Error("no repay ix");
    }
    expect(unwrapOption(repay.data.repayAll)).toBe(true);
  });
});
