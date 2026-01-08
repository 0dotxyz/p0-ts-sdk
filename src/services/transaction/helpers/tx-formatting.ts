import {
  PublicKey,
  VersionedTransaction,
  TransactionInstruction,
  TransactionMessage,
  AddressLookupTableAccount,
  Transaction,
  Blockhash,
} from "@solana/web3.js";
import {
  isV0Tx,
  decompileV0Transaction,
  decodeInstruction,
  getTxSize,
  SolanaTransaction,
} from "@mrgnlabs/mrgn-common";

import { MARGINFI_IDL, MarginfiIdlType } from "~/idl";

// Temporary imports
export const MAX_TX_SIZE = 1232;
export const BUNDLE_TX_SIZE = 81;
export const PRIORITY_TX_SIZE = 44;

export function isFlashloan(tx: SolanaTransaction): boolean {
  if (isV0Tx(tx)) {
    const addressLookupTableAccounts = tx.addressLookupTables ?? [];
    const message = decompileV0Transaction(tx, addressLookupTableAccounts);
    const idl = {
      ...MARGINFI_IDL,
      address: new PublicKey(0),
    } as unknown as MarginfiIdlType;
    const decoded = message.instructions.map((ix) =>
      decodeInstruction(idl, ix.data)
    );
    return decoded.some((ix) => ix?.name.toLowerCase().includes("flashloan"));
  }
  //TODO: add legacy tx check
  return false;
}

function getFlashloanIndex(transactions: SolanaTransaction[]): number | null {
  for (const [index, transaction] of transactions.entries()) {
    if (isFlashloan(transaction)) {
      return index;
    }
  }
  return null;
}

type FeeSettings = {
  priorityFeeMicro: number;
  bundleTipUi: number;
  feePayer: PublicKey;
  maxCapUi?: number;
};

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
