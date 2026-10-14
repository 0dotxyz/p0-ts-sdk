import { BN } from "@coral-xyz/anchor";
import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import { describe, expect, it } from "vitest";

import {
  account,
  balance,
  bank,
  instructionsOf,
  marginfiIxArgs,
  program,
  txBuildingConnection,
} from "../../../helpers/marginfi";

import { makeSwapDebtTx, SwapEngineRunner, SwapOpts, SwapProvider } from "~/services/account";
import { TOKEN_PROGRAM_ID } from "~/vendor/spl";

const collateral = bank();
const oldDebt = bank();
const newDebt = bank();
const bankMap = new Map([collateral, oldDebt, newDebt].map((b) => [b.address.toBase58(), b]));
const marginfiAccount = account([
  balance(collateral, "asset", 1_000e9),
  balance(oldDebt, "liability", 123_456_789),
]);

const swapProgram = PublicKey.unique();
const runner =
  (outAmount: string, otherAmountThreshold: string): SwapEngineRunner =>
  async () => ({
    swapInstructions: [
      new TransactionInstruction({ programId: swapProgram, keys: [], data: Buffer.from([1]) }),
    ],
    setupInstructions: [],
    swapLuts: [],
    quoteResponse: { inAmount: "18700000", outAmount, otherAmountThreshold, slippageBps: 50 },
    outputAmountNative: new BN(otherAmountThreshold),
    provider: SwapProvider.JUPITER,
  });

async function swapDebtTx(opts: { swapEngineRunner: SwapEngineRunner; swapOpts?: SwapOpts }) {
  const { transactions, actionTxIndex } = await makeSwapDebtTx({
    program,
    marginfiAccount,
    connection: txBuildingConnection,
    bankMap,
    oraclePrices: new Map(),
    bankMetadataMap: {},
    assetShareValueMultiplierByBank: new Map(),
    // 0.123456789123: whole native units round it down to 0.123456789 and up to 0.12345679
    repayOpts: {
      repayBank: oldDebt,
      tokenProgram: TOKEN_PROGRAM_ID,
      totalPositionAmount: 0.123456789123,
      marketPrice: 150,
    },
    borrowOpts: { borrowBank: newDebt, tokenProgram: TOKEN_PROGRAM_ID, marketPrice: 1 },
    swapOpts: opts.swapOpts ?? {},
    overrideInferAccounts: { group: marginfiAccount.group },
    swapEngineRunner: opts.swapEngineRunner,
  });
  return transactions[actionTxIndex];
}

type RepayArgs = { amount: BN; repayAll: boolean | null };

describe("makeSwapDebtTx", () => {
  it("repays all of a debt that isn't a whole number of native units", async () => {
    const tx = await swapDebtTx({ swapEngineRunner: runner("124000000", "123400000") });
    expect(marginfiIxArgs<RepayArgs>(tx, "lendingAccountRepay").repayAll).toBe(true);
  });

  it("repays the minimum output, not all, when the quote falls short of the debt", async () => {
    const tx = await swapDebtTx({ swapEngineRunner: runner("123456789", "123456789") });
    const repay = marginfiIxArgs<RepayArgs>(tx, "lendingAccountRepay");
    expect(repay.repayAll).toBeFalsy();
    expect(repay.amount.toString()).toBe("123456789");
  });

  it("borrows what a pinned route takes in and repays its minimum output", async () => {
    let engineCalled = false;
    const tx = await swapDebtTx({
      swapEngineRunner: async () => {
        engineCalled = true;
        throw new Error("the swap engine shouldn't run");
      },
      swapOpts: {
        swapIxs: {
          instructions: [
            new TransactionInstruction({
              programId: swapProgram,
              keys: [],
              data: Buffer.from([7]),
            }),
          ],
          lookupTables: [],
          quoteResponse: {
            inAmount: "15000000",
            outAmount: "100000000",
            otherAmountThreshold: "99000000",
            slippageBps: 50,
          },
        },
      },
    });

    expect(engineCalled).toBe(false);
    expect(instructionsOf(tx)).toContainEqual({ programId: swapProgram, data: Buffer.from([7]) });
    expect(marginfiIxArgs(tx, "lendingAccountBorrow").amount.toString()).toBe("15000000");
    const repay = marginfiIxArgs<RepayArgs>(tx, "lendingAccountRepay");
    expect(repay.amount.toString()).toBe("99000000");
    expect(repay.repayAll).toBeFalsy();
  });
});
