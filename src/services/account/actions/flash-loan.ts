import type { Instruction } from "@solana/kit";

import {
  MakeBeginFlashLoanIxParams,
  MakeEndFlashLoanIxParams,
  MakeFlashLoanTxParams,
} from "../types";
import { computeHealthAccounts, computeProjectedActiveBanksNoCpi } from "../utils";

import instructions from "~/instructions";
import { makeTransactionMessage, SolanaTransaction, TransactionType } from "~/services/transaction";

/**
 * Starts a flashloan on `marginfiAccount`: its health checks are deferred to the end-flashloan
 * instruction at transaction index `endIndex`.
 */
export async function makeBeginFlashLoanIx({
  programAddress,
  marginfiAccount,
  authority,
  endIndex,
}: MakeBeginFlashLoanIxParams): Promise<Instruction> {
  return instructions.makeBeginFlashLoanIx(programAddress, {
    marginfiAccount: marginfiAccount.address,
    authority,
    endIndex,
  });
}

/**
 * Ends a flashloan, health-checking `marginfiAccount` with `activeBanks` active.
 * @throws TransactionBuildingError (BANK_NOT_FOUND) if `bankMap` misses one of `activeBanks`
 */
export async function makeEndFlashLoanIx({
  programAddress,
  marginfiAccount,
  authority,
  bankMap,
  activeBanks,
}: MakeEndFlashLoanIxParams): Promise<Instruction> {
  return instructions.makeEndFlashLoanIx(
    programAddress,
    { marginfiAccount: marginfiAccount.address, group: marginfiAccount.group, authority },
    computeHealthAccounts(bankMap, activeBanks)
  );
}

/**
 * Wraps `ixs` in a flashloan on `marginfiAccount`, health-checked against the banks active after
 * `ixs`. The end index assumes the begin instruction stays first in the transaction, so put the
 * compute-budget instructions in `ixs`: a wallet that finds none prepends its own, which shifts
 * the index and fails the flashloan.
 * @throws TransactionBuildingError (BANK_NOT_FOUND) if `bankMap` misses a bank active after `ixs`
 */
export async function makeFlashLoanTx({
  programAddress,
  marginfiAccount,
  authority,
  ixs,
  bankMap,
  latestBlockhash,
  txFormat,
}: MakeFlashLoanTxParams): Promise<SolanaTransaction> {
  const beginIx = await makeBeginFlashLoanIx({
    programAddress,
    marginfiAccount,
    authority,
    endIndex: ixs.length + 1,
  });
  const endIx = await makeEndFlashLoanIx({
    programAddress,
    marginfiAccount,
    authority,
    bankMap,
    activeBanks: computeProjectedActiveBanksNoCpi({
      account: marginfiAccount,
      instructions: ixs,
      programAddress,
    }),
  });

  return {
    message: makeTransactionMessage({
      instructions: [beginIx, ...ixs, endIx],
      feePayer: authority,
      latestBlockhash,
      txFormat,
    }),
    type: TransactionType.FLASHLOAN,
  };
}
