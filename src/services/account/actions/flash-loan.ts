import type { Address, Instruction, TransactionSigner } from "@solana/kit";

import { MakeFlashLoanTxParams } from "../types";
import { computeHealthAccounts, computeProjectedActiveBanksNoCpi } from "../utils";

import instructions from "~/instructions";
import { BankType } from "~/services/bank";
import { makeTransactionMessage, SolanaTransaction, TransactionType } from "~/services/transaction";

export async function makeBeginFlashLoanIx(
  programAddress: Address,
  marginfiAccount: Address,
  endIndex: number,
  authority: TransactionSigner
): Promise<Instruction[]> {
  const ix = await instructions.makeBeginFlashLoanIx(programAddress, {
    marginfiAccount,
    authority,
    endIndex,
  });
  return [ix];
}

export async function makeEndFlashLoanIx(
  programAddress: Address,
  marginfiAccount: Address,
  group: Address,
  bankMap: Map<string, BankType>,
  activeBanks: Address[],
  authority: TransactionSigner
): Promise<Instruction[]> {
  const ix = await instructions.makeEndFlashLoanIx(
    programAddress,
    { marginfiAccount, group, authority },
    computeHealthAccounts(bankMap, activeBanks)
  );
  return [ix];
}

export async function makeFlashLoanTx({
  programAddress,
  marginfiAccount,
  authority,
  ixs,
  bankMap,
  latestBlockhash,
  txFormat,
}: MakeFlashLoanTxParams): Promise<SolanaTransaction> {
  const endIndex = ixs.length + 1;

  const projectedActiveBanks = computeProjectedActiveBanksNoCpi({
    account: marginfiAccount,
    instructions: ixs,
    programAddress,
  });

  const beginFlashLoanIxs = await makeBeginFlashLoanIx(
    programAddress,
    marginfiAccount.address,
    endIndex,
    authority
  );
  const endFlashLoanIxs = await makeEndFlashLoanIx(
    programAddress,
    marginfiAccount.address,
    marginfiAccount.group,
    bankMap,
    projectedActiveBanks,
    authority
  );

  return {
    message: makeTransactionMessage({
      instructions: [...beginFlashLoanIxs, ...ixs, ...endFlashLoanIxs],
      feePayer: authority,
      latestBlockhash,
      txFormat,
    }),
    type: TransactionType.FLASHLOAN,
  };
}
