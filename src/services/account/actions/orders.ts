import { type Instruction, type TransactionSigner } from "@solana/kit";

import {
  ActionTxParams,
  MakeCloseOrderIxParams,
  MakeCloseOrderTxParams,
  MakePlaceOrderIxParams,
  MakePlaceOrderTxParams,
  MakeUpdateOrderTxParams,
  OrderTriggerParams,
} from "../types";
import { fetchGlobalFeeWallet } from "../utils";

import { TransactionBuildingError } from "~/errors";
import instructions from "~/instructions";
import { makeTransactionMessage, SolanaTransaction, TransactionType } from "~/services/transaction";
import { OrderTrigger } from "~/types";
import { bigNumberToWrappedI80F48, deriveOrderPda, percentToMaxSlippageU32 } from "~/utils";

/**
 * Converts USD-equity thresholds into the on-chain `OrderTrigger` argument.
 *
 * @throws {TransactionBuildingError} `ORDER_INVALID_TRIGGER` if neither threshold is set, a
 *   threshold is not above 0, or take-profit ≤ stop-loss; `ORDER_INVALID_SLIPPAGE` via
 *   {@link percentToMaxSlippageU32}
 */
export function buildOrderTrigger(params: OrderTriggerParams): OrderTrigger {
  const { stopLossUsd, takeProfitUsd } = params;
  const maxSlippage = percentToMaxSlippageU32(params.maxSlippagePercent);
  const invalidTrigger = (reason: string) =>
    TransactionBuildingError.orderInvalidTrigger(
      reason,
      takeProfitUsd?.toString(),
      stopLossUsd?.toString()
    );

  if (stopLossUsd && !stopLossUsd.gt(0)) {
    throw invalidTrigger(`stop-loss threshold (${stopLossUsd}) must be above 0`);
  }
  if (takeProfitUsd && !takeProfitUsd.gt(0)) {
    throw invalidTrigger(`take-profit threshold (${takeProfitUsd}) must be above 0`);
  }
  if (stopLossUsd && takeProfitUsd) {
    if (takeProfitUsd.lte(stopLossUsd)) {
      throw invalidTrigger(
        `take-profit threshold (${takeProfitUsd}) must be above stop-loss threshold (${stopLossUsd})`
      );
    }
    return {
      __kind: "Both",
      stopLoss: bigNumberToWrappedI80F48(stopLossUsd),
      takeProfit: bigNumberToWrappedI80F48(takeProfitUsd),
      maxSlippage,
    };
  }
  if (stopLossUsd) {
    return { __kind: "StopLoss", threshold: bigNumberToWrappedI80F48(stopLossUsd), maxSlippage };
  }
  if (takeProfitUsd) {
    return {
      __kind: "TakeProfit",
      threshold: bigNumberToWrappedI80F48(takeProfitUsd),
      maxSlippage,
    };
  }
  throw invalidTrigger("an order needs a stop-loss threshold, a take-profit threshold, or both");
}

/**
 * Creates the instruction that places a take-profit / stop-loss order on a collateral/debt pair.
 * The order PDA is derived from the pair, so placing a second order on the same pair fails;
 * use {@link makeUpdateOrderTx} to change an existing order.
 *
 * The account must already hold (or, when bundled after a borrow/loop, will hold) an asset
 * balance in `collateralBank` and a liability balance in `debtBank`. The flat anti-spam fee from
 * the program's fee state is charged to `feePayer`.
 * @throws see {@link buildOrderTrigger}
 */
export async function makePlaceOrderIx({
  programAddress,
  marginfiAccount,
  authority,
  collateralBank,
  debtBank,
  trigger,
  feePayer = authority,
  globalFeeWallet,
}: MakePlaceOrderIxParams): Promise<Instruction> {
  const [order] = await deriveOrderPda(programAddress, marginfiAccount.address, [
    collateralBank,
    debtBank,
  ]);

  return instructions.makePlaceOrderIx(programAddress, {
    group: marginfiAccount.group,
    marginfiAccount: marginfiAccount.address,
    feePayer,
    authority,
    order,
    globalFeeWallet,
    bankKeys: [collateralBank, debtBank],
    trigger: buildOrderTrigger(trigger),
  });
}

/**
 * Creates the instruction that closes an order and returns its rent to `feeRecipient`.
 */
export async function makeCloseOrderIx({
  programAddress,
  marginfiAccount,
  authority,
  order,
  feeRecipient = authority.address,
}: MakeCloseOrderIxParams): Promise<Instruction> {
  return instructions.makeCloseOrderIx(programAddress, {
    group: marginfiAccount.group,
    marginfiAccount: marginfiAccount.address,
    authority,
    order,
    feeRecipient,
  });
}

async function compileOrderTx(
  { rpc, txFormat, latestBlockhash }: ActionTxParams,
  feePayer: TransactionSigner,
  ixs: Instruction[],
  type: TransactionType
): Promise<SolanaTransaction> {
  return {
    message: makeTransactionMessage({
      instructions: ixs,
      feePayer,
      latestBlockhash:
        latestBlockhash ?? (await rpc.getLatestBlockhash({ commitment: "confirmed" }).send()).value,
      txFormat,
    }),
    type,
  };
}

/**
 * Builds a place-order transaction around {@link makePlaceOrderIx}, reading the global fee wallet
 * from the program's fee state when `globalFeeWallet` is omitted. `feePayer` (default the
 * authority) pays; `latestBlockhash` is fetched when omitted.
 * @throws see {@link makePlaceOrderIx}
 * @throws TransactionBuildingError (FEE_STATE_NOT_FOUND) if `globalFeeWallet` is omitted and the
 * program's fee state account doesn't exist
 */
export async function makePlaceOrderTx(params: MakePlaceOrderTxParams): Promise<SolanaTransaction> {
  const placeIx = await makePlaceOrderIx({
    ...params,
    globalFeeWallet:
      params.globalFeeWallet ?? (await fetchGlobalFeeWallet(params.rpc, params.programAddress)),
  });
  return compileOrderTx(
    params,
    params.feePayer ?? params.authority,
    [placeIx],
    TransactionType.PLACE_ORDER
  );
}

/**
 * Builds a close-order transaction around {@link makeCloseOrderIx}. The authority pays and signs;
 * `latestBlockhash` is fetched when omitted.
 */
export async function makeCloseOrderTx(params: MakeCloseOrderTxParams): Promise<SolanaTransaction> {
  const closeIx = await makeCloseOrderIx(params);
  return compileOrderTx(params, params.authority, [closeIx], TransactionType.CLOSE_ORDER);
}

/**
 * Builds a transaction that replaces the pair's existing order with new thresholds. There is no
 * update instruction on-chain: the order (same PDA) is closed and re-placed in one transaction,
 * with its rent returned to `feePayer`. Balance tags are preserved across the close, so other
 * orders sharing a balance are unaffected. The flat anti-spam fee is charged again.
 * `latestBlockhash` is fetched when omitted.
 * @throws see {@link makePlaceOrderIx}
 * @throws TransactionBuildingError (FEE_STATE_NOT_FOUND) if `globalFeeWallet` is omitted and the
 * program's fee state account doesn't exist
 */
export async function makeUpdateOrderTx(
  params: MakeUpdateOrderTxParams
): Promise<SolanaTransaction> {
  const feePayer = params.feePayer ?? params.authority;
  const [order] = await deriveOrderPda(params.programAddress, params.marginfiAccount.address, [
    params.collateralBank,
    params.debtBank,
  ]);
  const closeIx = await makeCloseOrderIx({ ...params, order, feeRecipient: feePayer.address });
  const placeIx = await makePlaceOrderIx({
    ...params,
    feePayer,
    globalFeeWallet:
      params.globalFeeWallet ?? (await fetchGlobalFeeWallet(params.rpc, params.programAddress)),
  });
  return compileOrderTx(params, feePayer, [closeIx, placeIx], TransactionType.UPDATE_ORDER);
}
