import { address, createNoopSigner, type Address } from "@solana/kit";
import { BigNumber } from "bignumber.js";
import { describe, expect, it, vi } from "vitest";

import { addr, LATEST_BLOCKHASH } from "../../../helpers/addresses";
import { makeAccount, makeBalance, makeBank } from "../../../helpers/factories";
import { isMarginfiIx } from "../../../helpers/ix";
import { fakeRpc } from "../../../helpers/rpc";

import { TransactionBuildingError, TransactionBuildingErrorCode } from "~/errors";
import { MarginfiInstruction } from "~/instructions";
import {
  buildOrderTrigger,
  makeCloseOrderIx,
  makeOrderChangesTx,
  makePlaceOrderIx,
  makeUpdateOrderTx,
} from "~/services/account/actions/orders";
import type { MarginfiAccountType } from "~/services/account/types";
import { TransactionFormat, TransactionType } from "~/services/transaction";
import { deriveOrderPda, percentToMaxSlippageU32, wrappedI80F48toBigNumber } from "~/utils";

const programAddress = address("MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA");
const noLuts: TransactionFormat = { version: 0, luts: {} };

const expectBuildError = (run: () => unknown, code: TransactionBuildingErrorCode) => {
  try {
    run();
    expect.unreachable();
  } catch (error) {
    expect(error).toBeInstanceOf(TransactionBuildingError);
    expect((error as TransactionBuildingError).code).toBe(code);
  }
};

describe("buildOrderTrigger", () => {
  it("builds a stop-loss-only trigger", () => {
    const trigger = buildOrderTrigger({ stopLossUsd: new BigNumber(90), maxSlippagePercent: 1 });
    expect(trigger.__kind).toBe("StopLoss");
    if (trigger.__kind === "StopLoss") {
      expect(wrappedI80F48toBigNumber(trigger.threshold).toNumber()).toBe(90);
      expect(trigger.maxSlippage).toBe(percentToMaxSlippageU32(1));
    }
  });

  it("builds a both trigger when both thresholds are set", () => {
    const trigger = buildOrderTrigger({
      stopLossUsd: new BigNumber(90),
      takeProfitUsd: new BigNumber(120),
      maxSlippagePercent: 2,
    });
    expect(trigger.__kind).toBe("Both");
    if (trigger.__kind === "Both") {
      expect(wrappedI80F48toBigNumber(trigger.takeProfit).toNumber()).toBe(120);
    }
  });

  it("rejects take-profit at or below stop-loss, and empty triggers", () => {
    expectBuildError(
      () =>
        buildOrderTrigger({
          stopLossUsd: new BigNumber(100),
          takeProfitUsd: new BigNumber(100),
          maxSlippagePercent: 1,
        }),
      TransactionBuildingErrorCode.ORDER_INVALID_TRIGGER
    );
    expectBuildError(
      () => buildOrderTrigger({ maxSlippagePercent: 1 }),
      TransactionBuildingErrorCode.ORDER_INVALID_TRIGGER
    );
  });

  it("rejects thresholds that are not above 0, like the program", () => {
    for (const thresholds of [
      { stopLossUsd: new BigNumber(0) },
      { takeProfitUsd: new BigNumber(-5) },
      { stopLossUsd: new BigNumber(0), takeProfitUsd: new BigNumber(120) },
    ]) {
      expectBuildError(
        () => buildOrderTrigger({ ...thresholds, maxSlippagePercent: 1 }),
        TransactionBuildingErrorCode.ORDER_INVALID_TRIGGER
      );
    }
  });

  it("rejects slippage outside the cap", () => {
    expectBuildError(
      () => buildOrderTrigger({ stopLossUsd: new BigNumber(90), maxSlippagePercent: 0 }),
      TransactionBuildingErrorCode.ORDER_INVALID_SLIPPAGE
    );
  });
});

describe("makeUpdateOrderTx", () => {
  it("closes the pair's order, refunding the fee payer, then places the new one", async () => {
    const account = address("11111111111111111111111111111112");
    const bankA = address("CCKtUs6Cgwo4aaQUmBPmyoApH2gUDErxNZCAntD6LYGh");
    const bankB = address("2s37akK2eyBbp8DZgCm7RtsaEz8eJE3Nbb2b9dEVRR6d");
    const marginfiAccount = {
      address: account,
      group: address("4qp6Fx6tnZkY5Wropq9wUYgtFxXKwE6viZxFHg3rdAG8"),
    } as MarginfiAccountType;
    const authority = createNoopSigner(address("EwLiQ3MzGEUeRqtyYsqUtaZFgCkiDA9gLBxFjbGDCbhT"));
    const feePayer = createNoopSigner(address("Fa7LNzj3SCV364hya9dx9evL29pC1awx24iHeCEwX6vU"));
    const globalFeeWallet = address("11111111111111111111111111111113");
    const shared = {
      programAddress,
      marginfiAccount,
      authority,
      collateralBank: bankA,
      debtBank: bankB,
      trigger: { stopLossUsd: new BigNumber(100), maxSlippagePercent: 1 },
    };

    // A given fee wallet and blockhash leave nothing to fetch
    const tx = await makeUpdateOrderTx({
      ...shared,
      feePayer,
      globalFeeWallet,
      rpc: {} as never,
      txFormat: noLuts,
      latestBlockhash: LATEST_BLOCKHASH,
    });

    const [order] = await deriveOrderPda(programAddress, account, [bankA, bankB]);
    expect(tx.message.instructions).toEqual([
      await makeCloseOrderIx({ ...shared, order, feeRecipient: feePayer.address }),
      await makePlaceOrderIx({ ...shared, feePayer, globalFeeWallet }),
    ]);
  });
});

describe("makeOrderChangesTx", () => {
  const sol = makeBank({ premiumTag: 1, premiumActive: true });
  const usdc = makeBank({ premiumTag: 1, premiumActive: true });
  const holder = makeAccount([
    makeBalance(sol, "asset", 1_000e6),
    makeBalance(usdc, "liability", 100e6),
  ]);
  const authority = createNoopSigner(holder.authority);
  const isClose = isMarginfiIx(MarginfiInstruction.MarginfiAccountCloseOrder);
  const isPlace = isMarginfiIx(MarginfiInstruction.MarginfiAccountPlaceOrder);
  const orders = (count: number) => Array.from({ length: count }, addr);

  const pair = { collateralBank: sol.address, debtBank: usdc.address };
  const placeOrder = {
    ...pair,
    trigger: { stopLossUsd: new BigNumber(50), maxSlippagePercent: 1 },
    globalFeeWallet: addr(),
  };
  const changes = (params: { ordersToClose?: Address[]; place?: boolean }) =>
    makeOrderChangesTx({
      programAddress,
      marginfiAccount: holder,
      authority,
      ordersToClose: params.ordersToClose,
      placeOrder: params.place ? placeOrder : undefined,
      rpc: fakeRpc({ accountsExist: true }),
      txFormat: noLuts,
    });

  it("builds nothing, and fetches nothing, without changes", async () => {
    const offline = { getLatestBlockhash: vi.fn(), getAccountInfo: vi.fn() };
    const tx = await makeOrderChangesTx({
      programAddress,
      marginfiAccount: holder,
      authority,
      ordersToClose: [],
      rpc: offline as never,
      txFormat: noLuts,
    });

    expect(tx).toBeUndefined();
    expect(offline.getLatestBlockhash).not.toHaveBeenCalled();
  });

  it("closes, then places, as an update when the pair's own order is among the closes", async () => {
    const [pairOrder] = await deriveOrderPda(programAddress, holder.address, [
      pair.collateralBank,
      pair.debtBank,
    ]);
    const tx = await changes({ ordersToClose: [addr(), pairOrder], place: true });
    const ixs = tx?.message.instructions ?? [];

    expect(tx?.type).toBe(TransactionType.UPDATE_ORDER);
    expect(ixs.slice(0, 2).every(isClose)).toBe(true);
    expect(isPlace(ixs[2])).toBe(true);
  });

  it("tags a placement on a new pair and closes alone by what they do", async () => {
    const placed = await changes({ ordersToClose: [addr()], place: true });
    const closed = await changes({ ordersToClose: [addr()] });

    expect(placed?.type).toBe(TransactionType.PLACE_ORDER);
    expect(closed?.type).toBe(TransactionType.CLOSE_ORDER);
  });

  it("throws ORDER_CLOSES_DONT_FIT rather than spill into a second transaction", async () => {
    const error = await changes({ ordersToClose: orders(30), place: true }).catch(
      (e: unknown) => e
    );

    expect(error).toBeInstanceOf(TransactionBuildingError);
    expect((error as TransactionBuildingError).code).toBe(
      TransactionBuildingErrorCode.ORDER_CLOSES_DONT_FIT
    );
  });
});
