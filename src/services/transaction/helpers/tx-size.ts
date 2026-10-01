import {
  compileTransactionMessage,
  getTransactionMessageSize,
  getTransactionMessageSizeLimit,
} from "@solana/kit";

import { SolanaTransaction } from "../types";

type Message = SolanaTransaction["message"];

function countAccounts(message: Message) {
  const compiled = compileTransactionMessage(message);
  const staticAccounts = compiled.staticAccounts;
  const addressTableLookups =
    "addressTableLookups" in compiled ? (compiled.addressTableLookups ?? []) : [];
  const lutWritable = addressTableLookups.reduce((s, l) => s + l.writableIndexes.length, 0);
  const lutReadonly = addressTableLookups.reduce((s, l) => s + l.readonlyIndexes.length, 0);
  return {
    staticKeys: staticAccounts.length,
    numLuts: addressTableLookups.length,
    lutWritable,
    lutReadonly,
    totalAccounts: staticAccounts.length + lutWritable + lutReadonly,
  };
}

/**
 * Calculates the size in bytes of the transaction compiled from a message, signatures included.
 *
 * @param message - The transaction message
 * @returns The size in bytes, or 9999 when the message can't be compiled
 */
export function getTxSize(message: Message): number {
  try {
    const totalSize = getTransactionMessageSize(message);
    const sizeLimit = getTransactionMessageSizeLimit(message);
    if (totalSize > sizeLimit) {
      console.warn("[getTxSize] oversized TX", {
        totalSize,
        overshoot: totalSize - sizeLimit,
        ...countAccounts(message),
      });
    }
    return totalSize;
  } catch (err) {
    console.warn("[getTxSize] serialize failed", { error: (err as Error).message });
    return 9999;
  }
}

/**
 * Counts the account locks of a message: static accounts plus lookup-table-resolved accounts.
 *
 * @param message - The transaction message
 * @returns The number of accounts, or 9999 when the message can't be compiled
 */
export function getTotalAccountKeys(message: Message): number {
  try {
    return countAccounts(message).totalAccounts;
  } catch {
    return 9999;
  }
}
