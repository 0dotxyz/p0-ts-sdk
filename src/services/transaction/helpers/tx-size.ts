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
    return baseTxSize + feePayerSize + signaturesSize;
  } catch {
    // tx is overflowing
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
  } catch {
    return 9999;
  }
}
