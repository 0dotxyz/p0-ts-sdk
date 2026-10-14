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

import { makeSwapCollateralTx, SwapOpts } from "~/services/account";
import { TOKEN_PROGRAM_ID } from "~/vendor/spl";

const oldCollateral = bank();
const newCollateral = bank();
const bankMap = new Map([oldCollateral, newCollateral].map((b) => [b.address.toBase58(), b]));
const marginfiAccount = account([balance(oldCollateral, "asset", 10e9)]);

const swapProgram = PublicKey.unique();
const pinnedSwap = new TransactionInstruction({
  programId: swapProgram,
  keys: [],
  data: Buffer.from([7]),
});
const pinnedRoute = (inAmount: string, otherAmountThreshold: string): SwapOpts => ({
  swapIxs: {
    instructions: [pinnedSwap],
    lookupTables: [],
    quoteResponse: {
      inAmount,
      outAmount: otherAmountThreshold,
      otherAmountThreshold,
      slippageBps: 50,
    },
  },
});

async function swapCollateralTx(swapOpts: SwapOpts) {
  const { transactions, actionTxIndex } = await makeSwapCollateralTx({
    program,
    marginfiAccount,
    connection: txBuildingConnection,
    bankMap,
    oraclePrices: new Map(),
    bankMetadataMap: {},
    assetShareValueMultiplierByBank: new Map(),
    withdrawOpts: {
      withdrawBank: oldCollateral,
      tokenProgram: TOKEN_PROGRAM_ID,
      totalPositionAmount: 10,
      withdrawAmount: 4,
    },
    depositOpts: { depositBank: newCollateral, tokenProgram: TOKEN_PROGRAM_ID },
    swapOpts,
    overrideInferAccounts: { group: marginfiAccount.group },
    swapEngineRunner: async () => {
      throw new Error("the swap engine shouldn't run");
    },
  });
  return transactions[actionTxIndex];
}

describe("makeSwapCollateralTx", () => {
  it("swaps through a pinned route and deposits its minimum output", async () => {
    const tx = await swapCollateralTx(pinnedRoute("4000000000", "3900000000"));

    expect(instructionsOf(tx)).toContainEqual({ programId: swapProgram, data: Buffer.from([7]) });
    expect(marginfiIxArgs(tx, "lendingAccountDeposit").amount.toString()).toBe("3900000000");
  });

  it("rejects a pinned route quoted for a different amount than the withdrawal", async () => {
    await expect(swapCollateralTx(pinnedRoute("3000000000", "2900000000"))).rejects.toThrow(
      /inAmount=3000000000.*swap input=4000000000/
    );
  });
});
