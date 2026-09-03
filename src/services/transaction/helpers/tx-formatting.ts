import {
  PublicKey,
  VersionedTransaction,
  TransactionInstruction,
  TransactionMessage,
  AddressLookupTableAccount,
  Transaction,
  Blockhash,
} from "@solana/web3.js";

import { ExtendedTransactionProperties, SolanaTransaction } from "../types";

import { decodeInstruction, decompileV0Transaction } from "./decode";
import { getTxSize } from "./tx-size";

import { MAX_TX_SIZE, ADDRESS_LOOKUP_TABLE_FOR_GROUP_NATIVE_STAKE } from "~/constants";
import { MARGINFI_IDL, MarginfiIdlType } from "~/idl";
import { AssetTag, BankType } from "~/services/bank/types/bank.types";

/** Base58 keys of every native-stake LUT across all groups (group-agnostic membership test). */
const NATIVE_STAKE_LUT_KEYS = new Set(
  Object.values(ADDRESS_LOOKUP_TABLE_FOR_GROUP_NATIVE_STAKE)
    .flat()
    .map((key) => key.toBase58())
);

/**
 * Picks the lean native-stake LUT subset when every involved bank is STAKED or SOL,
 * otherwise the general subset. Operates on a combined `luts` array (general +
 * native-stake) by partitioning it against the SDK's known native-stake LUT keys, so
 * callers only ever pass one array and the right subset is embedded per transaction.
 *
 * Native-stake accounts can only supply native-stake positions and borrow SOL, so such
 * transactions are fully served by the lean set; any non-(STAKED|SOL) bank falls back to
 * the general set. Degrades gracefully: if the array wasn't split (e.g. only the general
 * set was provided), it returns the input unchanged.
 *
 * @param luts - Combined LUT accounts available to the transaction
 * @param banks - Every bank the transaction touches (target bank + health-check banks)
 */
export function selectLutsForBanks(
  luts: AddressLookupTableAccount[],
  banks: BankType[]
): AddressLookupTableAccount[] {
  const nativeStakeLuts = luts.filter((lut) => NATIVE_STAKE_LUT_KEYS.has(lut.key.toBase58()));
  const generalLuts = luts.filter((lut) => !NATIVE_STAKE_LUT_KEYS.has(lut.key.toBase58()));

  const allStakedOrSol =
    banks.length > 0 &&
    banks.every(
      (bank) => bank.config.assetTag === AssetTag.STAKED || bank.config.assetTag === AssetTag.SOL
    );

  if (allStakedOrSol && nativeStakeLuts.length > 0) {
    return nativeStakeLuts;
  }
  return generalLuts.length > 0 ? generalLuts : luts;
}

/**
 * Convenience wrapper over {@link selectLutsForBanks} for account actions: collects the
 * banks a transaction touches (the target bank, the account's active-position banks, and
 * any extra health-check banks) and selects the matching LUT subset. Uses structural
 * typing for `balances` to avoid an import cycle with the account module.
 */
export function selectLutsForAccountAction(
  luts: AddressLookupTableAccount[],
  targetBank: BankType,
  balances: { active: boolean; bankPk: PublicKey }[],
  bankMap: Map<string, BankType>,
  extraBankAddresses: PublicKey[] = []
): AddressLookupTableAccount[] {
  const banks: BankType[] = [targetBank];
  for (const balance of balances) {
    if (!balance.active) continue;
    const bank = bankMap.get(balance.bankPk.toBase58());
    if (bank) banks.push(bank);
  }
  for (const address of extraBankAddresses) {
    const bank = bankMap.get(address.toBase58());
    if (bank) banks.push(bank);
  }
  return selectLutsForBanks(luts, banks);
}

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

/** Total account locks of a compiled v0 tx: static keys plus LUT-resolved keys. */
function countTxAccountLocks(tx: VersionedTransaction): number {
  const message = tx.message;
  const lookupKeys = (message.addressTableLookups ?? []).reduce(
    (count, lookup) => count + lookup.writableIndexes.length + lookup.readonlyIndexes.length,
    0
  );
  return message.staticAccountKeys.length + lookupKeys;
}

/**
 * Splits your instructions into as many VersionedTransactions as needed
 * so that none exceed MAX_TX_SIZE (minus `sizeMargin`, if given) nor
 * `maxAccountLocks` account locks (if given).
 */
export function splitInstructionsToFitTransactions(
  mandatoryIxs: TransactionInstruction[],
  ixs: TransactionInstruction[],
  opts: {
    blockhash: string;
    payerKey: PublicKey;
    luts: AddressLookupTableAccount[];
    /** Bytes reserved below MAX_TX_SIZE, e.g. for compute-budget ixs appended at send time. */
    sizeMargin?: number;
    /** Also cap the total account locks per transaction (e.g. MAX_ACCOUNT_LOCKS). */
    maxAccountLocks?: number;
  }
): VersionedTransaction[] {
  const result: VersionedTransaction[] = [];
  let buffer: TransactionInstruction[] = [];
  const maxSize = MAX_TX_SIZE - (opts.sizeMargin ?? 0);

  function buildTx(extraIxs: TransactionInstruction[]): VersionedTransaction {
    const messageV0 = new TransactionMessage({
      payerKey: opts.payerKey,
      recentBlockhash: opts.blockhash,
      instructions: [...mandatoryIxs, ...extraIxs],
    }).compileToV0Message(opts.luts);

    return new VersionedTransaction(messageV0);
  }

  // Compiling a message that overflows the compact-array encoding throws a
  // RangeError; treat that as "does not fit".
  function fits(extraIxs: TransactionInstruction[]): boolean {
    try {
      const tx = buildTx(extraIxs);
      if (getTxSize(tx) > maxSize) return false;
      if (opts.maxAccountLocks !== undefined && countTxAccountLocks(tx) > opts.maxAccountLocks) {
        return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  for (const ix of ixs) {
    if (fits([...buffer, ix])) {
      buffer.push(ix);
      continue;
    }

    // If buffer is empty, this single ix won't fit even alone
    if (buffer.length === 0) {
      throw new Error("Single instruction too large to fit in a transaction");
    }
    // Flush current buffer as its own tx and start a new one with this ix
    result.push(buildTx(buffer));
    buffer = [ix];
    if (!fits(buffer)) {
      throw new Error("Single instruction too large to fit in a transaction");
    }
  }

  // Flush any remaining
  if (buffer.length > 0) {
    result.push(buildTx(buffer));
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
