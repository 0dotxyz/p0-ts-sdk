import {
  address,
  createNoopSigner,
  createSolanaRpc,
  getAddressDecoder,
  getBase64Encoder,
  unwrapOption,
} from "@solana/kit";
import { BigNumber } from "bignumber.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import accountFixtures from "../../../fixtures/mainnet-accounts.json";
import bankFixtures from "../../../fixtures/mainnet-banks.json";

import { MarginfiInstruction, parseMarginfiIx } from "~/instructions";
import { makeRepayWithCollatTx } from "~/services/account/actions/repay";
import { SwapProvider, type MarginfiAccountType } from "~/services/account/types";
import { decodeMarginfiAccount } from "~/services/account/utils/deserialize.utils";
import { BankType } from "~/services/bank";
import { decodeBank } from "~/services/bank/utils/deserialize.utils";

const base64 = getBase64Encoder();
const programAddress = address("MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA");
const tokenProgram = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const swapProgram = address("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4");

// Mainnet account with a liability in the SOL bank fixture, given a deposit in a copy of that bank
// to repay it from; its other positions are dropped so every active bank is loaded
const banks = Object.fromEntries(
  bankFixtures.map(({ label, address: bankAddress, data }) => [
    label.split(" ")[0],
    decodeBank(address(bankAddress), base64.encode(data)),
  ])
);
const copyOfSol = (fill: number, mint: BankType["mint"]): BankType => ({
  ...banks.sol,
  address: getAddressDecoder().decode(new Uint8Array(32).fill(fill)),
  mint,
});
const solCollateralBank = copyOfSol(7, banks.sol.mint);
const usdcCollateralBank = {
  ...copyOfSol(8, getAddressDecoder().decode(new Uint8Array(32).fill(9))),
  mintDecimals: 6,
};
const bankMap = new Map(
  [...Object.values(banks), solCollateralBank, usdcCollateralBank].map((bank) => [
    bank.address,
    bank,
  ])
);

const parsed = decodeMarginfiAccount(
  address(accountFixtures[1].address),
  base64.encode(accountFixtures[1].data)
);
function withDepositIn(bank: BankType): MarginfiAccountType {
  const balances = parsed.balances.filter(
    (balance) => !balance.active || bankMap.has(balance.bankPk)
  );
  const firstFree = balances.findIndex((balance) => !balance.active);
  return {
    ...parsed,
    balances: balances.map((balance, index) =>
      index === firstFree
        ? {
            ...balance,
            active: true,
            bankPk: bank.address,
            assetShares: new BigNumber(10e9),
            liabilityShares: new BigNumber(0),
          }
        : balance
    ),
  };
}

// 0.123456789123 SOL: whole native units round it down to 0.123456789 and up to 0.12345679
const DEBT = 0.123456789123;

function repayWithCollat(opts: {
  withdrawBank: BankType;
  withdrawAmount: number;
  quote?: { outAmount: string; otherAmountThreshold: string };
}) {
  const {
    withdrawBank,
    withdrawAmount,
    quote = { outAmount: "0", otherAmountThreshold: "0" },
  } = opts;
  const marginfiAccount = withDepositIn(withdrawBank);
  return makeRepayWithCollatTx({
    programAddress,
    marginfiAccount,
    authority: createNoopSigner(marginfiAccount.authority),
    rpc: createSolanaRpc("http://repay.test"),
    bankMap,
    bankMetadataMap: {},
    assetShareValueMultiplierByBank: new Map(),
    withdrawOpts: { withdrawBank, tokenProgram, withdrawAmount, totalPositionAmount: 10 },
    repayOpts: { repayBank: banks.sol, tokenProgram, totalPositionAmount: DEBT },
    swapOpts: {},
    txFormat: { version: 0, luts: {} },
    swapEngineRunner: async () => ({
      swapInstructions: [{ programAddress: swapProgram, accounts: [], data: new Uint8Array([1]) }],
      setupInstructions: [],
      swapLuts: {},
      quoteResponse: { inAmount: "1", slippageBps: 50, ...quote },
      outputAmountNative: BigInt(quote.otherAmountThreshold),
      provider: SwapProvider.JUPITER,
    }),
  });
}

async function repayIxOf(result: Awaited<ReturnType<typeof makeRepayWithCollatTx>>) {
  const repay = result.transactions
    .flatMap((tx) => tx.message.instructions)
    .map(parseMarginfiIx)
    .find((ix) => ix?.instructionType === MarginfiInstruction.LendingAccountRepay);
  if (repay?.instructionType !== MarginfiInstruction.LendingAccountRepay) {
    throw new Error("no repay ix");
  }
  return { repayAll: unwrapOption(repay.data.repayAll), amount: repay.data.amount };
}

describe("makeRepayWithCollatTx", () => {
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

  it("repays all of the debt when the withdrawal covers it in whole native units", async () => {
    const result = await repayWithCollat({
      withdrawBank: solCollateralBank,
      withdrawAmount: 0.12345679,
    });
    expect((await repayIxOf(result)).repayAll).toBe(true);
  });

  it("doesn't repay all when the withdrawal is the debt rounded down", async () => {
    const result = await repayWithCollat({
      withdrawBank: solCollateralBank,
      withdrawAmount: 0.123456789,
    });
    expect((await repayIxOf(result)).repayAll).toBe(false);
  });

  it("repays all of the debt when the quoted output exceeds it", async () => {
    const result = await repayWithCollat({
      withdrawBank: usdcCollateralBank,
      withdrawAmount: 20,
      quote: { outAmount: "124000000", otherAmountThreshold: "123400000" },
    });
    expect((await repayIxOf(result)).repayAll).toBe(true);
  });

  it("repays the minimum output, not all, when the quote falls short of the debt", async () => {
    const result = await repayWithCollat({
      withdrawBank: usdcCollateralBank,
      withdrawAmount: 20,
      quote: { outAmount: "123456789", otherAmountThreshold: "123456789" },
    });
    const repay = await repayIxOf(result);
    expect(repay.repayAll).toBe(false);
    expect(repay.amount).toBe(123_456_789n);
  });
});
