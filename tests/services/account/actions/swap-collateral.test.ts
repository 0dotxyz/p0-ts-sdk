import { createNoopSigner, unwrapOption } from "@solana/kit";
import { TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { key } from "../../../helpers/addresses";
import { makeAccount, makeBalance, makeBank } from "../../../helpers/factories";
import { findMarginfiIxs } from "../../../helpers/ix";
import { mainnetAccount, mainnetBankMap, mainnetBanks } from "../../../helpers/mainnet";
import { stubRpcFetch, stubbedRpc } from "../../../helpers/rpc";

import { MARGINFI_PROGRAM } from "~/constants";
import { TransactionBuildingErrorCode } from "~/errors";
import { MarginfiInstruction, parseMarginfiIx } from "~/instructions";
import { makeSwapCollateralTx } from "~/services/account/actions/swap-collateral";
import type { SwapEngineRunner } from "~/services/account/services/swap-engine";
import { SwapProvider, type MarginfiAccountType, type SwapOpts } from "~/services/account/types";
import { AssetTag, type BankType } from "~/services/bank";
import { TransactionType } from "~/services/transaction";

const swapProgram = key(200);

// The account holds the default (mSOL) bank fixture; it swaps into a copy of that bank, under the
// same mint or another one
const sameMintBank = { ...mainnetBanks.default, address: key(70) };
const otherMintBank = { ...mainnetBanks.default, address: key(71), mint: key(72) };
const bankMap = new Map([
  ...mainnetBankMap,
  ...[sameMintBank, otherMintBank].map((bank) => [bank.address as string, bank] as const),
]);
const marginfiAccount = mainnetAccount(bankMap);

const swapRunner = (outputAmountNative: bigint) =>
  vi.fn<SwapEngineRunner>(async () => ({
    swapInstructions: [{ programAddress: swapProgram, accounts: [], data: new Uint8Array([1]) }],
    setupInstructions: [],
    swapLuts: {},
    quoteResponse: {
      inAmount: "4000000000",
      outAmount: outputAmountNative.toString(),
      otherAmountThreshold: outputAmountNative.toString(),
      slippageBps: 50,
    },
    outputAmountNative,
    provider: SwapProvider.JUPITER,
  }));

function swapCollateral(opts: {
  depositBank: BankType;
  withdrawAmount?: number;
  swapEngineRunner?: SwapEngineRunner;
  account?: MarginfiAccountType;
  withdrawBank?: BankType;
  ordersToClose?: ReturnType<typeof key>[];
  swapOpts?: SwapOpts;
}) {
  const account = opts.account ?? marginfiAccount;
  return makeSwapCollateralTx({
    programAddress: MARGINFI_PROGRAM,
    marginfiAccount: account,
    authority: createNoopSigner(account.authority),
    rpc: stubbedRpc,
    bankMap,
    bankMetadataMap: {},
    assetShareValueMultiplierByBank: new Map(),
    withdrawOpts: {
      withdrawBank: opts.withdrawBank ?? mainnetBanks.default,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
      totalPositionAmount: 10,
      withdrawAmount: opts.withdrawAmount,
    },
    depositOpts: { depositBank: opts.depositBank, tokenProgram: TOKEN_PROGRAM_ADDRESS },
    swapOpts: opts.swapOpts ?? {},
    txFormat: { version: 0, luts: {} },
    swapEngineRunner: opts.swapEngineRunner,
    ordersToClose: opts.ordersToClose,
  });
}

describe("makeSwapCollateralTx", () => {
  beforeEach(stubRpcFetch);

  it("withdraws, swaps and deposits the swap's guaranteed output inside one flashloan", async () => {
    const runner = swapRunner(3_900_000_000n);
    const result = await swapCollateral({
      depositBank: otherMintBank,
      withdrawAmount: 4,
      swapEngineRunner: runner,
    });

    const flashloan = result.transactions[result.actionTxIndex];
    expect(flashloan.type).toBe(TransactionType.FLASHLOAN);
    expect(
      flashloan.message.instructions
        .filter((ix) => ix.programAddress === MARGINFI_PROGRAM || ix.programAddress === swapProgram)
        .map((ix) =>
          ix.programAddress === swapProgram ? "swap" : parseMarginfiIx(ix)?.instructionType
        )
    ).toEqual([
      MarginfiInstruction.LendingAccountStartFlashloan,
      MarginfiInstruction.LendingAccountWithdraw,
      "swap",
      MarginfiInstruction.LendingAccountDeposit,
      MarginfiInstruction.LendingAccountEndFlashloan,
    ]);
    const [deposit] = findMarginfiIxs(MarginfiInstruction.LendingAccountDeposit, flashloan);
    expect(deposit.data.amount).toBe(3_900_000_000n);
    expect(runner.mock.calls[0][0]).toMatchObject({
      inputMint: mainnetBanks.default.mint,
      outputMint: otherMintBank.mint,
      amountNative: 4_000_000_000,
    });
  });

  it("swaps through a pinned route instead of asking the swap engine", async () => {
    const runner = swapRunner(0n);
    const pinnedSwap = { programAddress: swapProgram, accounts: [], data: new Uint8Array([7]) };
    const result = await swapCollateral({
      depositBank: otherMintBank,
      withdrawAmount: 4,
      swapEngineRunner: runner,
      swapOpts: {
        swapIxs: {
          instructions: [pinnedSwap],
          lookupTables: {},
          quoteResponse: {
            inAmount: "4000000000",
            outAmount: "3950000000",
            otherAmountThreshold: "3900000000",
            slippageBps: 50,
          },
        },
      },
    });

    expect(runner).not.toHaveBeenCalled();
    const flashloan = result.transactions[result.actionTxIndex];
    expect(flashloan.message.instructions).toContain(pinnedSwap);
    const [deposit] = findMarginfiIxs(MarginfiInstruction.LendingAccountDeposit, flashloan);
    expect(deposit.data.amount).toBe(3_900_000_000n);
  });

  it("rejects a pinned route quoted for a different amount than the withdrawal", async () => {
    await expect(
      swapCollateral({
        depositBank: otherMintBank,
        withdrawAmount: 4,
        swapOpts: {
          swapIxs: {
            instructions: [],
            lookupTables: {},
            quoteResponse: {
              inAmount: "3000000000",
              outAmount: "2950000000",
              otherAmountThreshold: "2900000000",
              slippageBps: 50,
            },
          },
        },
      })
    ).rejects.toThrow(/inAmount=3000000000.*swap input=4000000000/);
  });

  it("deposits the withdrawn amount without a swap when both banks share a mint", async () => {
    const runner = swapRunner(0n);
    const result = await swapCollateral({
      depositBank: sameMintBank,
      withdrawAmount: 4,
      swapEngineRunner: runner,
    });

    expect(runner).not.toHaveBeenCalled();
    expect(result.quoteResponse).toBeUndefined();
    const [deposit] = findMarginfiIxs(
      MarginfiInstruction.LendingAccountDeposit,
      result.transactions[result.actionTxIndex]
    );
    expect(deposit.data.amount).toBe(4_000_000_000n);
  });

  it("withdraws all only when the whole position is swapped", async () => {
    const withdrawAllOf = async (withdrawAmount?: number) => {
      const result = await swapCollateral({ depositBank: sameMintBank, withdrawAmount });
      const [withdraw] = findMarginfiIxs(
        MarginfiInstruction.LendingAccountWithdraw,
        result.transactions[result.actionTxIndex]
      );
      return unwrapOption(withdraw.data.withdrawAll) ?? false;
    };

    expect(await withdrawAllOf()).toBe(true);
    expect(await withdrawAllOf(10)).toBe(true);
    expect(await withdrawAllOf(9.999)).toBe(false);
  });

  it("closes the given orders in a transaction after the flashloan, as one bundle", async () => {
    const order = key(90);
    const result = await swapCollateral({
      depositBank: sameMintBank,
      withdrawAmount: 4,
      ordersToClose: [order],
    });

    const orderTx = result.transactions[result.transactions.length - 1];
    expect(result.actionTxIndex).toBe(result.transactions.length - 2);
    expect(orderTx.type).toBe(TransactionType.CLOSE_ORDER);
    const [close] = findMarginfiIxs(MarginfiInstruction.MarginfiAccountCloseOrder, orderTx);
    expect(close.accounts.order.address).toBe(order);
    expect(result.mustBeAtomicBundle).toBe(true);
  });

  it("rejects a withdraw amount that isn't positive", async () => {
    await expect(
      swapCollateral({ depositBank: sameMintBank, withdrawAmount: 0 })
    ).rejects.toMatchObject({
      code: TransactionBuildingErrorCode.INVALID_AMOUNT,
    });
  });

  describe("costly position limit", () => {
    // Four staked positions: the account can't open a fifth integration or staked one
    const staked = Array.from({ length: 5 }, () =>
      makeBank({
        config: { assetTag: AssetTag.STAKED, oracleKeys: [key(1), key(2), key(3), key(4)] },
      })
    );
    const atLimit = makeAccount([
      makeBalance(mainnetBanks.default, "asset", 10e9),
      ...staked.slice(0, 4).map((bank) => makeBalance(bank, "asset", 1e9)),
    ]);
    for (const bank of staked) bankMap.set(bank.address, bank);

    it("rejects a deposit that would open a fifth one", async () => {
      await expect(
        swapCollateral({ account: atLimit, depositBank: staked[4], withdrawAmount: 4 })
      ).rejects.toMatchObject({
        code: TransactionBuildingErrorCode.COSTLY_POSITION_LIMIT_EXCEEDED,
      });
    });

    it("counts a position the swap withdraws in full as closed", async () => {
      const result = await swapCollateral({
        account: atLimit,
        withdrawBank: staked[0],
        depositBank: staked[4],
        swapEngineRunner: swapRunner(1n),
      });
      expect(result.transactions[result.actionTxIndex].type).toBe(TransactionType.FLASHLOAN);
    });
  });
});
