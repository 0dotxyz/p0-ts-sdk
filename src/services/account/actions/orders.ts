import {
  AddressLookupTableAccount,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";

import {
  MakeCloseOrderIxParams,
  MakeCloseOrderTxParams,
  MakeOrderChangesIxParams,
  MakeOrderChangesTxParams,
  MakePlaceOrderIxParams,
  MakePlaceOrderTxParams,
  MarginfiAccountType,
  OrderChangesParams,
  OrderTriggerParams,
} from "../types";

import { BUNDLE_TX_SIZE, MAX_ACCOUNT_LOCKS, PRIORITY_TX_SIZE } from "~/constants";
import { TransactionBuildingError } from "~/errors";
import instructions from "~/instructions";
import {
  addTransactionMetadata,
  ExtendedV0Transaction,
  fitsInOneTransaction,
  InstructionsWrapper,
  TransactionType,
} from "~/services/transaction";
import { MarginfiProgram, OrderTrigger } from "~/types";
import {
  bigNumberToWrappedI80F48,
  deriveFeeState,
  deriveOrderPda,
  percentToMaxSlippageU32,
} from "~/utils";

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
      both: {
        stopLoss: bigNumberToWrappedI80F48(stopLossUsd),
        takeProfit: bigNumberToWrappedI80F48(takeProfitUsd),
        maxSlippage,
      },
    };
  }
  if (stopLossUsd) {
    return { stopLoss: { threshold: bigNumberToWrappedI80F48(stopLossUsd), maxSlippage } };
  }
  if (takeProfitUsd) {
    return { takeProfit: { threshold: bigNumberToWrappedI80F48(takeProfitUsd), maxSlippage } };
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
 */
export async function makePlaceOrderIx(
  params: MakePlaceOrderIxParams
): Promise<InstructionsWrapper> {
  const { program, marginfiAccount, collateralBank, debtBank, trigger, feePayer } = params;

  const [order] = deriveOrderPda(program.programId, marginfiAccount.address, [
    collateralBank,
    debtBank,
  ]);
  const globalFeeWallet =
    params.globalFeeWallet ??
    (await program.account.feeState.fetch(deriveFeeState(program.programId)[0])).globalFeeWallet;

  const placeOrderIx = await instructions.makePlaceOrderIx(
    program,
    {
      marginfiAccount: marginfiAccount.address,
      feePayer: feePayer ?? marginfiAccount.authority,
      authority: marginfiAccount.authority,
      order,
      globalFeeWallet,
      group: marginfiAccount.group,
    },
    { bankKeys: [collateralBank, debtBank], trigger: buildOrderTrigger(trigger) }
  );

  return { instructions: [placeOrderIx], keys: [] };
}

/**
 * Creates the instruction that closes an order and returns its rent to `feeRecipient`.
 */
export async function makeCloseOrderIx(
  params: MakeCloseOrderIxParams
): Promise<InstructionsWrapper> {
  const { program, marginfiAccount, order, feeRecipient } = params;

  const closeOrderIx = await instructions.makeCloseOrderIx(program, {
    marginfiAccount: marginfiAccount.address,
    authority: marginfiAccount.authority,
    order,
    feeRecipient: feeRecipient ?? marginfiAccount.authority,
    group: marginfiAccount.group,
  });

  return { instructions: [closeOrderIx], keys: [] };
}

async function compileOrderTx(
  params: Pick<MakePlaceOrderTxParams, "connection" | "luts" | "blockhash">,
  payerKey: PublicKey,
  ixs: InstructionsWrapper[],
  type: TransactionType
): Promise<ExtendedV0Transaction> {
  const blockhash =
    params.blockhash ??
    (await params.connection.getLatestBlockhashAndContext("confirmed")).value.blockhash;

  return addTransactionMetadata(
    new VersionedTransaction(
      new TransactionMessage({
        instructions: ixs.flatMap((ix) => ix.instructions),
        payerKey,
        recentBlockhash: blockhash,
      }).compileToV0Message(params.luts)
    ),
    { type, signers: ixs.flatMap((ix) => ix.keys), addressLookupTables: params.luts }
  );
}

/**
 * Builds a transaction that places a new order on a collateral/debt pair.
 *
 * @see {@link makePlaceOrderIx}
 */
export async function makePlaceOrderTx(
  params: MakePlaceOrderTxParams
): Promise<ExtendedV0Transaction> {
  const placeIxs = await makePlaceOrderIx(params);
  const payerKey = params.feePayer ?? params.marginfiAccount.authority;
  return compileOrderTx(params, payerKey, [placeIxs], TransactionType.PLACE_ORDER);
}

/**
 * Builds a transaction that closes an existing order.
 *
 * @see {@link makeCloseOrderIx}
 */
export async function makeCloseOrderTx(
  params: MakeCloseOrderTxParams
): Promise<ExtendedV0Transaction> {
  const closeIxs = await makeCloseOrderIx(params);
  return compileOrderTx(
    params,
    params.marginfiAccount.authority,
    [closeIxs],
    TransactionType.CLOSE_ORDER
  );
}

/**
 * Builds a transaction that replaces the pair's existing order with new thresholds.
 *
 * There is no update instruction on-chain: the existing order (same PDA) is closed and re-placed
 * in one transaction. Balance tags are preserved across the close, so other orders sharing a
 * balance are unaffected. The flat anti-spam fee is charged again.
 */
export async function makeUpdateOrderTx(
  params: MakePlaceOrderTxParams
): Promise<ExtendedV0Transaction> {
  const [order] = deriveOrderPda(params.program.programId, params.marginfiAccount.address, [
    params.collateralBank,
    params.debtBank,
  ]);
  const closeIxs = await makeCloseOrderIx({ ...params, order, feeRecipient: params.feePayer });
  const placeIxs = await makePlaceOrderIx(params);
  const payerKey = params.feePayer ?? params.marginfiAccount.authority;
  return compileOrderTx(params, payerKey, [closeIxs, placeIxs], TransactionType.UPDATE_ORDER);
}

// Leaves room for what the send pipeline appends: compute-budget and priority-fee ixs, and in
// bundles a Jito tip, which lock the ComputeBudget program, tip account and System program
const SEND_PIPELINE_MARGINS = {
  sizeMargin: PRIORITY_TX_SIZE + BUNDLE_TX_SIZE,
  maxAccountLocks: MAX_ACCOUNT_LOCKS - 3,
};

/**
 * Instructions closing `ordersToClose`, then placing `placeOrder`, for composing with an action.
 * The closes return the rent to the authority.
 *
 * @param params - The account, the orders to close and the order to place
 * @returns The closes, then the placement
 * @throws {TransactionBuildingError} `ORDER_INVALID_TRIGGER` / `ORDER_INVALID_SLIPPAGE` for an
 *   invalid `placeOrder.trigger`
 */
export async function makeOrderChangesIxs(
  params: MakeOrderChangesIxParams
): Promise<TransactionInstruction[]> {
  const { program, marginfiAccount, ordersToClose = [], placeOrder } = params;
  const wrappers = await Promise.all([
    ...ordersToClose.map((order) => makeCloseOrderIx({ program, marginfiAccount, order })),
    ...(placeOrder ? [makePlaceOrderIx({ ...placeOrder, program, marginfiAccount })] : []),
  ]);
  return wrappers.flatMap((wrapper) => wrapper.instructions);
}

/**
 * Puts the closes of `ordersToClose` in front of an action that lands in one transaction. Unlike
 * the premium refresh they can't be left out, so builders call this before `appendPremiumRefresh`,
 * which then only adds the refresh if it still fits.
 *
 * @param params - The builder's params: program, account (before the action), orders to close and
 *   authority
 * @param actionIxs - The action's instructions
 * @param luts - The lookup tables the transaction compiles with
 * @returns The closes, then the action's instructions
 * @throws {TransactionBuildingError} `ORDER_CLOSES_DONT_FIT` if the closes don't fit next to the
 *   action
 */
export async function prependOrderCloses(
  params: OrderChangesParams & {
    program: MarginfiProgram;
    marginfiAccount: MarginfiAccountType;
    authority: PublicKey;
  },
  actionIxs: TransactionInstruction[],
  luts: AddressLookupTableAccount[]
): Promise<TransactionInstruction[]> {
  const { program, marginfiAccount, ordersToClose = [] } = params;
  if (ordersToClose.length === 0) return actionIxs;

  const closeIxs = await makeOrderChangesIxs({ program, marginfiAccount, ordersToClose });
  const withCloses = [...closeIxs, ...actionIxs];
  if (
    !fitsInOneTransaction(withCloses, {
      payerKey: params.authority,
      luts,
      ...SEND_PIPELINE_MARGINS,
    })
  ) {
    throw TransactionBuildingError.orderClosesDontFit(
      ordersToClose.map((order) => order.toBase58())
    );
  }
  return withCloses;
}

/**
 * Builds the transaction that closes `ordersToClose`, then places `placeOrder`, after a
 * multi-transaction action, to send in the same atomic bundle. Also adds order changes to an
 * action built earlier without rebuilding it, e.g. a loop's take-profit / stop-loss set after its
 * quote.
 *
 * @param params - The account, the orders to close, the order to place and the lookup tables
 * @returns The transaction to run after the action, none when there's nothing to change
 * @throws {TransactionBuildingError} `ORDER_CLOSES_DONT_FIT` if the changes don't fit in one
 *   transaction; `ORDER_INVALID_TRIGGER` / `ORDER_INVALID_SLIPPAGE` for an invalid
 *   `placeOrder.trigger`
 */
export async function makeOrderChangesTx(
  params: MakeOrderChangesTxParams
): Promise<ExtendedV0Transaction | undefined> {
  const { program, marginfiAccount, ordersToClose = [], placeOrder, luts } = params;
  const ixs = await makeOrderChangesIxs(params);
  if (ixs.length === 0) return undefined;
  if (
    !fitsInOneTransaction(ixs, {
      payerKey: marginfiAccount.authority,
      luts,
      ...SEND_PIPELINE_MARGINS,
    })
  ) {
    throw TransactionBuildingError.orderClosesDontFit(
      ordersToClose.map((order) => order.toBase58())
    );
  }

  let type = TransactionType.CLOSE_ORDER;
  if (placeOrder) {
    const [placedOrder] = deriveOrderPda(program.programId, marginfiAccount.address, [
      placeOrder.collateralBank,
      placeOrder.debtBank,
    ]);
    type = ordersToClose.some((order) => order.equals(placedOrder))
      ? TransactionType.UPDATE_ORDER
      : TransactionType.PLACE_ORDER;
  }
  return compileOrderTx(params, marginfiAccount.authority, [{ instructions: ixs, keys: [] }], type);
}
