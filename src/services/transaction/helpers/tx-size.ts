import {
  AddressLookupTableAccount,
  Transaction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";

import { isV0Tx } from "./tx-formatting";

/**
 * Calculates the size of a Solana transaction in bytes.
 * This function considers the number of required signatures and other transaction components.
 *
 * @param tx - The transaction object, which can be either a VersionedTransaction or a Transaction.
 * @returns The size of the transaction in bytes.
 */
export function getTxSize(tx: VersionedTransaction | Transaction): number {
  const isVersioned = isV0Tx(tx);
  const numSigners = tx.signatures.length;
  const numRequiredSignatures = isVersioned ? tx.message.header.numRequiredSignatures : 0;
  const feePayerSize = isVersioned || tx.feePayer ? 0 : 32;
  const signaturesSize = (numRequiredSignatures - numSigners) * 64 + 1;

  try {
    const baseTxSize = isVersioned
      ? tx.serialize().length
      : tx.serialize({ requireAllSignatures: false, verifySignatures: false }).length;
    const totalSize = baseTxSize + feePayerSize + signaturesSize;
    if (isVersioned && totalSize > 1232) {
      const { header, staticAccountKeys, addressTableLookups } = tx.message;
      const lutWritable = addressTableLookups.reduce((s, l) => s + l.writableIndexes.length, 0);
      const lutReadonly = addressTableLookups.reduce((s, l) => s + l.readonlyIndexes.length, 0);
      console.warn("[getTxSize] oversized TX", {
        totalSize,
        overshoot: totalSize - 1232,
        staticKeys: staticAccountKeys.length,
        numSignatures: header.numRequiredSignatures,
        numLuts: addressTableLookups.length,
        lutWritable,
        lutReadonly,
        totalAccounts: staticAccountKeys.length + lutWritable + lutReadonly,
      });
    }
    return totalSize;
  } catch (err) {
    // tx is overflowing — log metadata for debugging
    if (isVersioned) {
      const { header, staticAccountKeys, addressTableLookups } = tx.message;
      const lutWritable = addressTableLookups.reduce((s, l) => s + l.writableIndexes.length, 0);
      const lutReadonly = addressTableLookups.reduce((s, l) => s + l.readonlyIndexes.length, 0);
      console.warn("[getTxSize] serialize failed", {
        error: (err as Error).message,
        staticKeys: staticAccountKeys.length,
        numSignatures: header.numRequiredSignatures,
        numLuts: addressTableLookups.length,
        lutWritable,
        lutReadonly,
        totalAccounts: staticAccountKeys.length + lutWritable + lutReadonly,
      });
    } else {
      console.warn("[getTxSize] serialize failed", { error: (err as Error).message });
    }
    return 9999;
  }
}

export function getAccountKeys(
  tx: VersionedTransaction | Transaction,
  lookupTableAccounts: AddressLookupTableAccount[]
): number {
  const isVersioned = isV0Tx(tx);

  try {
    if (isVersioned) {
      const message = TransactionMessage.decompile(tx.message, {
        addressLookupTableAccounts: lookupTableAccounts,
      });
      return message.compileToLegacyMessage().getAccountKeys().length;
    } else {
      return tx.compileMessage().getAccountKeys().length;
    }
  } catch (err) {
    console.warn("[getAccountKeys] decompile failed", { error: (err as Error).message });
    return 9999;
  }
}

export function getWritableAccountKeys(tx: VersionedTransaction | Transaction): number {
  const isVersioned = isV0Tx(tx);

  try {
    if (isVersioned) {
      const { header, staticAccountKeys, addressTableLookups } = tx.message;
      const writableStatic =
        staticAccountKeys.length -
        header.numReadonlySignedAccounts -
        header.numReadonlyUnsignedAccounts;
      const writableLut = addressTableLookups.reduce(
        (sum, lookup) => sum + lookup.writableIndexes.length,
        0
      );
      return writableStatic + writableLut;
    } else {
      // Legacy: count non-readonly keys from compiled message
      const message = tx.compileMessage();
      const { numRequiredSignatures, numReadonlySignedAccounts, numReadonlyUnsignedAccounts } =
        message.header;
      const totalKeys = message.accountKeys.length;
      const writableSigned = numRequiredSignatures - numReadonlySignedAccounts;
      const writableUnsigned = totalKeys - numRequiredSignatures - numReadonlyUnsignedAccounts;
      return writableSigned + writableUnsigned;
    }
  } catch {
    return 9999;
  }
}

export function getTotalAccountKeys(tx: VersionedTransaction | Transaction): number {
  const isVersioned = isV0Tx(tx);

  try {
    if (isVersioned) {
      const { staticAccountKeys, addressTableLookups } = tx.message;
      const lutAccounts = addressTableLookups.reduce(
        (sum, lookup) => sum + lookup.writableIndexes.length + lookup.readonlyIndexes.length,
        0
      );
      return staticAccountKeys.length + lutAccounts;
    } else {
      return tx.compileMessage().accountKeys.length;
    }
  } catch {
    return 9999;
  }
}
