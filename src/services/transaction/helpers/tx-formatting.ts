import {
  appendTransactionMessageInstructions,
  compressTransactionMessageUsingAddressLookupTables,
  createTransactionMessage,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  type Address,
  type AddressesByLookupTableAddress,
  type BlockhashLifetimeConstraint,
  type Instruction,
  type TransactionSigner,
} from "@solana/kit";

import { SolanaTransaction } from "../types";

import { getTotalAccountKeys, getTxSize } from "./tx-size";

import { MAX_TX_SIZE, ADDRESS_LOOKUP_TABLE_FOR_GROUP_NATIVE_STAKE } from "~/constants";
import { MarginfiInstruction, parseMarginfiIx } from "~/instructions";
import { AssetTag, BankType } from "~/services/bank/types/bank.types";

/** Keys of every native-stake LUT across all groups (group-agnostic membership test). */
const NATIVE_STAKE_LUT_KEYS = new Set<string>(
  Object.values(ADDRESS_LOOKUP_TABLE_FOR_GROUP_NATIVE_STAKE).flat()
);

/**
 * Picks the lean native-stake LUT subset when every involved bank is STAKED or SOL,
 * otherwise the general subset. Operates on a combined `luts` map (general +
 * native-stake) by partitioning it against the SDK's known native-stake LUT keys, so
 * callers only ever pass one map and the right subset is embedded per transaction.
 *
 * Native-stake accounts can only supply native-stake positions and borrow SOL, so such
 * transactions are fully served by the lean set; any non-(STAKED|SOL) bank falls back to
 * the general set. Degrades gracefully: if the map wasn't split (e.g. only the general
 * set was provided), it returns the input unchanged.
 *
 * @param luts - Combined lookup tables available to the transaction
 * @param banks - Every bank the transaction touches (target bank + health-check banks)
 */
export function selectLutsForBanks(
  luts: AddressesByLookupTableAddress,
  banks: BankType[]
): AddressesByLookupTableAddress {
  const entries = Object.entries(luts);
  const nativeStakeLuts = Object.fromEntries(
    entries.filter(([key]) => NATIVE_STAKE_LUT_KEYS.has(key))
  );
  const generalLuts = Object.fromEntries(
    entries.filter(([key]) => !NATIVE_STAKE_LUT_KEYS.has(key))
  );

  const allStakedOrSol =
    banks.length > 0 &&
    banks.every(
      (bank) => bank.config.assetTag === AssetTag.STAKED || bank.config.assetTag === AssetTag.SOL
    );

  if (allStakedOrSol && Object.keys(nativeStakeLuts).length > 0) {
    return nativeStakeLuts;
  }
  return Object.keys(generalLuts).length > 0 ? generalLuts : luts;
}

/**
 * Convenience wrapper over {@link selectLutsForBanks} for account actions: collects the
 * banks a transaction touches (the target bank, the account's active-position banks, and
 * any extra health-check banks) and selects the matching LUT subset. Uses structural
 * typing for `balances` to avoid an import cycle with the account module.
 */
export function selectLutsForAccountAction(
  luts: AddressesByLookupTableAddress,
  targetBank: BankType,
  balances: { active: boolean; bankPk: Address }[],
  bankMap: Map<string, BankType>,
  extraBankAddresses: Address[] = []
): AddressesByLookupTableAddress {
  const banks: BankType[] = [targetBank];
  for (const balance of balances) {
    if (!balance.active) continue;
    const bank = bankMap.get(balance.bankPk);
    if (bank) banks.push(bank);
  }
  for (const address of extraBankAddresses) {
    const bank = bankMap.get(address);
    if (bank) banks.push(bank);
  }
  return selectLutsForBanks(luts, banks);
}

/**
 * Whether a transaction contains a marginfi flashloan instruction (start or end).
 */
export function isFlashloan(tx: SolanaTransaction): boolean {
  return tx.message.instructions.some((ix) => {
    const parsed = parseMarginfiIx(ix);
    return (
      parsed !== undefined &&
      MarginfiInstruction[parsed.instructionType].toLowerCase().includes("flashloan")
    );
  });
}

/**
 * Builds a v0 transaction message: `feePayer` pays and signs, `latestBlockhash` sets the lifetime
 * and accounts found in `luts` are compressed into lookups.
 *
 * @param params.instructions - Instructions in execution order
 * @param params.feePayer - Fee payer signer
 * @param params.latestBlockhash - Blockhash lifetime (e.g. from `getLatestBlockhash`)
 * @param params.luts - Lookup tables to compress accounts with
 * @returns The compilable, lifetime-bound transaction message
 */
export function makeTransactionMessage({
  instructions,
  feePayer,
  latestBlockhash,
  luts = {},
}: {
  instructions: Instruction[];
  feePayer: TransactionSigner;
  latestBlockhash: BlockhashLifetimeConstraint;
  luts?: AddressesByLookupTableAddress;
}): SolanaTransaction["message"] {
  return pipe(
    createTransactionMessage({ version: 0 }),
    (message) => setTransactionMessageFeePayerSigner(feePayer, message),
    (message) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, message),
    (message) => appendTransactionMessageInstructions(instructions, message),
    (message) => compressTransactionMessageUsingAddressLookupTables(message, luts)
  );
}

/**
 * Splits your instructions into as many transaction messages as needed
 * so that none exceed MAX_TX_SIZE (minus `sizeMargin`, if given) nor
 * `maxAccountLocks` account locks (if given).
 */
export function splitInstructionsToFitTransactions(
  mandatoryIxs: Instruction[],
  ixs: Instruction[],
  opts: {
    latestBlockhash: BlockhashLifetimeConstraint;
    feePayer: TransactionSigner;
    luts: AddressesByLookupTableAddress;
    /** Bytes reserved below MAX_TX_SIZE, e.g. for compute-budget ixs appended at send time. */
    sizeMargin?: number;
    /** Also cap the total account locks per transaction (e.g. MAX_ACCOUNT_LOCKS). */
    maxAccountLocks?: number;
  }
): SolanaTransaction["message"][] {
  const result: SolanaTransaction["message"][] = [];
  let buffer: Instruction[] = [];
  const maxSize = MAX_TX_SIZE - (opts.sizeMargin ?? 0);

  function buildTx(extraIxs: Instruction[]): SolanaTransaction["message"] {
    return makeTransactionMessage({
      instructions: [...mandatoryIxs, ...extraIxs],
      feePayer: opts.feePayer,
      latestBlockhash: opts.latestBlockhash,
      luts: opts.luts,
    });
  }

  // A message that can't be compiled (e.g. too many accounts) does not fit.
  function fits(extraIxs: Instruction[]): boolean {
    try {
      const tx = buildTx(extraIxs);
      if (getTxSize(tx) > maxSize) return false;
      if (opts.maxAccountLocks !== undefined && getTotalAccountKeys(tx) > opts.maxAccountLocks) {
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
