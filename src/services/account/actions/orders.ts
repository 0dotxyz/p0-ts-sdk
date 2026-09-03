import { PublicKey, TransactionMessage, VersionedTransaction } from "@solana/web3.js";

import {
  MakeCloseOrderIxParams,
  MakeCloseOrderTxParams,
  MakePlaceOrderIxParams,
  MakePlaceOrderTxParams,
  OrderTriggerParams,
} from "../types";

import instructions from "~/instructions";
import {
  addTransactionMetadata,
  ExtendedV0Transaction,
  InstructionsWrapper,
  TransactionType,
} from "~/services/transaction";
import { OrderTrigger } from "~/types";
import {
  bigNumberToWrappedI80F48,
  deriveFeeState,
  deriveOrderPda,
  percentToMaxSlippageU32,
} from "~/utils";

/**
 * Converts USD-equity thresholds into the on-chain `OrderTrigger` argument.
 *
 * @throws If neither threshold is set, or both are set with take-profit ≤ stop-loss
 */
export function buildOrderTrigger(params: OrderTriggerParams): OrderTrigger {
  const { stopLossUsd, takeProfitUsd } = params;
  const maxSlippage = percentToMaxSlippageU32(params.maxSlippagePercent);

  if (stopLossUsd && takeProfitUsd) {
    if (takeProfitUsd.lte(stopLossUsd)) {
      throw new Error(
        `Take-profit threshold (${takeProfitUsd}) must be above stop-loss threshold (${stopLossUsd})`
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
  throw new Error("An order needs a stop-loss threshold, a take-profit threshold, or both");
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
