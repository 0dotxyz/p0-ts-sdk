import { AccountRole, type Address, type Instruction, type TransactionSigner } from "@solana/kit";

import { MakeFlashLoanTxParams } from "../types";
import { computeHealthAccountMetas, computeProjectedActiveBanksNoCpi } from "../utils";

import instructions from "~/instructions";
import { BankType, requireBank } from "~/services/bank";
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
  projectedActiveBanks: BankType[],
  authority: TransactionSigner
): Promise<Instruction[]> {
  const remainingAccounts = computeHealthAccountMetas({ banksToInclude: projectedActiveBanks });
  const ix = await instructions.makeEndFlashLoanIx(
    programAddress,
    { marginfiAccount, group, authority },
    remainingAccounts.map((address) => ({ address, role: AccountRole.READONLY }))
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
  luts,
}: MakeFlashLoanTxParams): Promise<SolanaTransaction> {
  const endIndex = ixs.length + 1;

  const projectedActiveBanks = computeProjectedActiveBanksNoCpi({
    account: marginfiAccount,
    instructions: ixs,
    programAddress,
  }).map((bankAddress) => requireBank(bankMap, bankAddress));

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
    projectedActiveBanks,
    authority
  );

  return {
    message: makeTransactionMessage({
      instructions: [...beginFlashLoanIxs, ...ixs, ...endFlashLoanIxs],
      feePayer: authority,
      latestBlockhash,
      luts,
    }),
    type: TransactionType.FLASHLOAN,
  };
}
