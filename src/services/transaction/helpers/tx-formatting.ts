import {
  PublicKey,
  VersionedTransaction,
  TransactionInstruction,
  TransactionMessage,
  AddressLookupTableAccount,
  Transaction,
  Blockhash,
} from "@solana/web3.js";

import { MARGINFI_IDL, MarginfiIdlType } from "~/idl";
import { MAX_TX_SIZE } from "~/constants";

import { ExtendedTransactionProperties, SolanaTransaction } from "../types";

import { decodeInstruction, decompileV0Transaction } from "./decode";
import { getTxSize } from "./tx-size";

/**
 * Determines if a given transaction is a VersionedTransaction.
 * This function checks for the presence of a 'message' property to identify
 * if the transaction is of type VersionedTransaction.
 *
 * @param tx - The transaction object, which can be either a VersionedTransaction or a Transaction.
 * @returns A boolean indicating whether the transaction is a VersionedTransaction.
 */
export function isV0Tx(tx: Transaction | VersionedTransaction): tx is VersionedTransaction {
  return "message" in tx;
}

export function isFlashloan(tx: SolanaTransaction): boolean {
  if (isV0Tx(tx)) {
    const addressLookupTableAccounts = tx.addressLookupTables ?? [];
    const message = decompileV0Transaction(tx, addressLookupTableAccounts);
    const idl = {
      ...MARGINFI_IDL,
      address: new PublicKey(0),
    } as unknown as MarginfiIdlType;
    const decoded = message.instructions.map((ix) => decodeInstruction(idl, ix.data));
    return decoded.some((ix) => ix?.name.toLowerCase().includes("flashloan"));
  }
  //TODO: add legacy tx check
  return false;
}

export async function makeVersionedTransaction(
  blockhash: Blockhash,
  transaction: Transaction,
  payer: PublicKey,
  addressLookupTables?: AddressLookupTableAccount[]
): Promise<VersionedTransaction> {
  const message = new TransactionMessage({
    instructions: transaction.instructions,
    payerKey: payer,
    recentBlockhash: blockhash,
  });

  const versionedMessage = addressLookupTables
    ? message.compileToV0Message(addressLookupTables)
    : message.compileToLegacyMessage();

  return new VersionedTransaction(versionedMessage);
}

/**
 * Splits your instructions into as many VersionedTransactions as needed
 * so that none exceed MAX_TX_SIZE.
 */
export function splitInstructionsToFitTransactions(
  mandatoryIxs: TransactionInstruction[],
  ixs: TransactionInstruction[],
  opts: {
    blockhash: string;
    payerKey: PublicKey;
    luts: AddressLookupTableAccount[];
  }
): VersionedTransaction[] {
  const result: VersionedTransaction[] = [];
  let buffer: TransactionInstruction[] = [];

  function buildTx(
    mandatoryIxs: TransactionInstruction[],
    extraIxs: TransactionInstruction[],
    opts: {
      blockhash: string;
      payerKey: PublicKey;
      luts: AddressLookupTableAccount[];
    }
  ): VersionedTransaction {
    const messageV0 = new TransactionMessage({
      payerKey: opts.payerKey,
      recentBlockhash: opts.blockhash,
      instructions: [...mandatoryIxs, ...extraIxs],
    }).compileToV0Message(opts.luts);

    return new VersionedTransaction(messageV0);
  }

  for (const ix of ixs) {
    // Try adding this ix to the current buffer
    const trial = buildTx(mandatoryIxs, [...buffer, ix], opts);
    if (getTxSize(trial) <= MAX_TX_SIZE) {
      buffer.push(ix);
    } else {
      // If buffer is empty, this single ix won't fit even alone
      if (buffer.length === 0) {
        throw new Error("Single instruction too large to fit in a transaction");
      }
      // Flush current buffer as its own tx
      const tx = buildTx(mandatoryIxs, buffer, opts);
      result.push(tx);

      // Start new buffer with this ix
      buffer = [ix];

      // And check if that alone fits
      const solo = buildTx(mandatoryIxs, buffer, opts);
      if (getTxSize(solo) > MAX_TX_SIZE) {
        throw new Error("Single instruction too large to fit in a transaction");
      }
    }
  }

  // Flush any remaining
  if (buffer.length > 0) {
    const tx = buildTx(mandatoryIxs, buffer, opts);
    result.push(tx);
  }

  return result;
}

/**
 * Enhances a given transaction with additional metadata.
 *
 * @param transaction - The transaction to be enhanced, can be either VersionedTransaction or Transaction.
 * @param options - An object containing optional metadata:
 *   - signers: An array of Signer objects that are associated with the transaction.
 *   - addressLookupTables: An array of AddressLookupTableAccount objects for address resolution.
 *   - unitsConsumed: A number representing the compute units consumed by the transaction.
 *   - type: The type of the transaction, as defined by TransactionType.
 * @returns A SolanaTransaction object that includes the original transaction and the additional metadata.
 */
export function addTransactionMetadata<T extends Transaction | VersionedTransaction>(
  transaction: T,
  options: ExtendedTransactionProperties
): T & ExtendedTransactionProperties {
  return Object.assign(transaction, options);
}
