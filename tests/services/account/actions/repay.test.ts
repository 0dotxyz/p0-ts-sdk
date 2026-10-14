import { address, createNoopSigner, unwrapOption } from "@solana/kit";
import { BigNumber } from "bignumber.js";
import { beforeEach, describe, expect, it } from "vitest";

import { key } from "../../../helpers/addresses";
import { findMarginfiIxs } from "../../../helpers/ix";
import { mainnetAccount, mainnetBanks } from "../../../helpers/mainnet";
import { stubRpcFetch, stubbedRpc } from "../../../helpers/rpc";

import { MarginfiInstruction } from "~/instructions";
import { makeRepayWithCollatTx } from "~/services/account/actions/repay";
import { SwapProvider, type MarginfiAccountType } from "~/services/account/types";
import { BankType } from "~/services/bank";

const programAddress = address("MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA");
const tokenProgram = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const swapProgram = address("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4");

// The account's SOL debt is repaid from a deposit in a copy of the SOL bank
const copyOfSol = (fill: number, mint: BankType["mint"]): BankType => ({
  ...mainnetBanks.sol,
  address: key(fill),
  mint,
});
const solCollateralBank = copyOfSol(7, mainnetBanks.sol.mint);
const usdcCollateralBank = {
  ...copyOfSol(8, key(9)),
  mintDecimals: 6,
};
const bankMap = new Map(
  [...Object.values(mainnetBanks), solCollateralBank, usdcCollateralBank].map((bank) => [
    bank.address,
    bank,
  ])
);

function withDepositIn(bank: BankType): MarginfiAccountType {
  const account = mainnetAccount(bankMap);
  const firstFree = account.balances.findIndex((balance) => !balance.active);
  return {
    ...account,
    balances: account.balances.map((balance, index) =>
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
    rpc: stubbedRpc,
    bankMap,
    bankMetadataMap: {},
    assetShareValueMultiplierByBank: new Map(),
    withdrawOpts: { withdrawBank, tokenProgram, withdrawAmount, totalPositionAmount: 10 },
    repayOpts: { repayBank: mainnetBanks.sol, tokenProgram, totalPositionAmount: DEBT },
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

function repayIxOf(result: Awaited<ReturnType<typeof makeRepayWithCollatTx>>) {
  const [repay] = findMarginfiIxs(MarginfiInstruction.LendingAccountRepay, ...result.transactions);
  return { repayAll: unwrapOption(repay.data.repayAll), amount: repay.data.amount };
}

describe("makeRepayWithCollatTx", () => {
  beforeEach(stubRpcFetch);

  it("repays all of the debt when the withdrawal covers it in whole native units", async () => {
    const result = await repayWithCollat({
      withdrawBank: solCollateralBank,
      withdrawAmount: 0.12345679,
    });
    expect(repayIxOf(result).repayAll).toBe(true);
  });

  it("doesn't repay all when the withdrawal is the debt rounded down", async () => {
    const result = await repayWithCollat({
      withdrawBank: solCollateralBank,
      withdrawAmount: 0.123456789,
    });
    expect(repayIxOf(result).repayAll).toBe(false);
  });

  it("repays all of the debt when the quoted output exceeds it", async () => {
    const result = await repayWithCollat({
      withdrawBank: usdcCollateralBank,
      withdrawAmount: 20,
      quote: { outAmount: "124000000", otherAmountThreshold: "123400000" },
    });
    expect(repayIxOf(result).repayAll).toBe(true);
  });

  it("repays the minimum output, not all, when the quote falls short of the debt", async () => {
    const result = await repayWithCollat({
      withdrawBank: usdcCollateralBank,
      withdrawAmount: 20,
      quote: { outAmount: "123456789", otherAmountThreshold: "123456789" },
    });
    const repay = repayIxOf(result);
    expect(repay.repayAll).toBe(false);
    expect(repay.amount).toBe(123_456_789n);
  });
});
