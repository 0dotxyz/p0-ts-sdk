import { address, createNoopSigner, unwrapOption } from "@solana/kit";
import { BigNumber } from "bignumber.js";
import { beforeEach, describe, expect, it } from "vitest";

import { key } from "../../../helpers/addresses";
import { findMarginfiIxs } from "../../../helpers/ix";
import { mainnetAccount, mainnetBanks } from "../../../helpers/mainnet";
import { stubRpcFetch, stubbedRpc } from "../../../helpers/rpc";

import { TransactionBuildingError } from "~/errors";
import { MarginfiInstruction } from "~/instructions";
import { makeBridgedSwapDebtTx, makeSwapDebtTx } from "~/services/account/actions/swap-debt";
import type { SwapEngineRequest } from "~/services/account/services/swap-engine";
import { SwapProvider } from "~/services/account/types";

const programAddress = address("MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA");
const tokenProgram = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const swapProgram = address("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4");

// The account's SOL debt is swapped into debt on a copy of the SOL bank under another address and
// mint
const copyOfSol = (fill: number) => ({
  ...mainnetBanks.sol,
  address: key(fill),
  mint: key(fill + 1),
  mintDecimals: 6,
});
const borrowBank = copyOfSol(7);
const otherDebtBank = copyOfSol(10);
const bankMap = new Map(
  [...Object.values(mainnetBanks), borrowBank, otherDebtBank].map((bank) => [bank.address, bank])
);
const marginfiAccount = mainnetAccount(bankMap);

describe("makeSwapDebtTx", () => {
  beforeEach(stubRpcFetch);

  it("repays all of a debt that isn't a whole number of native units", async () => {
    const result = await makeSwapDebtTx({
      programAddress,
      marginfiAccount,
      authority: createNoopSigner(marginfiAccount.authority),
      rpc: stubbedRpc,
      bankMap,
      bankMetadataMap: {},
      assetShareValueMultiplierByBank: new Map(),
      repayOpts: {
        repayBank: mainnetBanks.sol,
        tokenProgram,
        totalPositionAmount: 0.123456789123,
        marketPrice: 150,
      },
      borrowOpts: { borrowBank, tokenProgram, marketPrice: 1 },
      swapOpts: {},
      txFormat: { version: 0, luts: {} },
      swapEngineRunner: async () => ({
        swapInstructions: [
          { programAddress: swapProgram, accounts: [], data: new Uint8Array([1]) },
        ],
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

    const [repay] = findMarginfiIxs(
      MarginfiInstruction.LendingAccountRepay,
      result.transactions[result.actionTxIndex]
    );
    expect(unwrapOption(repay.data.repayAll)).toBe(true);
  });

  it("doesn't repay-all a bridge the account already owed", async () => {
    // The account also owes `otherDebtBank`, swapped into `borrowBank` through its SOL debt
    const firstFree = marginfiAccount.balances.findIndex((balance) => !balance.active);
    const balances = marginfiAccount.balances.map((balance, index) =>
      index === firstFree
        ? {
            ...balance,
            active: true,
            bankPk: otherDebtBank.address,
            assetShares: new BigNumber(0),
            liabilityShares: new BigNumber(10e6),
          }
        : balance
    );
    const quote = (inAmount: string, outAmount: string) => ({
      swapInstructions: [{ programAddress: swapProgram, accounts: [], data: new Uint8Array([1]) }],
      setupInstructions: [],
      swapLuts: {},
      quoteResponse: { inAmount, outAmount, otherAmountThreshold: outAmount, slippageBps: 50 },
      outputAmountNative: BigInt(outAmount),
      provider: SwapProvider.JUPITER,
    });
    const price = (value: number) => ({ priceRealtime: { price: new BigNumber(value) } });

    const result = await makeBridgedSwapDebtTx({
      programAddress,
      marginfiAccount: { ...marginfiAccount, balances },
      authority: createNoopSigner(marginfiAccount.authority),
      rpc: stubbedRpc,
      bankMap,
      bankMetadataMap: {},
      assetShareValueMultiplierByBank: new Map(),
      repayOpts: {
        repayBank: otherDebtBank,
        tokenProgram,
        totalPositionAmount: 10,
        marketPrice: 1,
      },
      borrowOpts: { borrowBank, tokenProgram, marketPrice: 1 },
      swapOpts: {},
      txFormat: { version: 0, luts: {} },
      bridgeOpts: {
        bridgeCandidateMints: [mainnetBanks.sol.mint],
        tokenProgramByMint: new Map([[mainnetBanks.sol.mint, tokenProgram]]),
      },
      oraclePrices: new Map([
        [otherDebtBank.address, price(1)],
        [mainnetBanks.sol.address, price(150)],
        [borrowBank.address, price(1)],
      ]) as never,
      swapEngineRunner: async (request: SwapEngineRequest) => {
        if (request.inputMint === borrowBank.mint && request.outputMint === otherDebtBank.mint) {
          throw TransactionBuildingError.swapQuoteFailed("test", "", "", "no route");
        }
        // Open leg: 0.07 SOL into 10.1 of the debt; close leg: 11 into 0.0705 SOL, covering the
        // 0.07 SOL the open leg borrowed but not the SOL the account already owed
        return request.outputMint === otherDebtBank.mint
          ? quote("70000000", "10100000")
          : quote("11000000", "70500000");
      },
    });

    expect(result.bridgeMint).toBe(mainnetBanks.sol.mint);
    const [solRepay] = findMarginfiIxs(
      MarginfiInstruction.LendingAccountRepay,
      result.transactions[result.actionTxIndex]
    ).filter((ix) => ix.accounts.bank.address === mainnetBanks.sol.address);
    expect(unwrapOption(solRepay.data.repayAll)).toBe(false);
  });
});
