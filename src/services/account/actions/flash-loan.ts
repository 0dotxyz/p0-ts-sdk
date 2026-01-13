import { PublicKey, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import BN from "bn.js";

import { BankType } from "~/services/bank";
import {
  addTransactionMetadata,
  InstructionsWrapper,
  TransactionType,
} from "~/services/transaction";
import { MarginfiProgram } from "~/types";
import instructions from "~/instructions";
import syncInstructions from "~/sync-instructions";

import { computeHealthAccountMetas, computeProjectedActiveBanksNoCpi } from "../utils";
import { MakeFlashLoanTxParams } from "../types";

export async function makeBeginFlashLoanIx(
  program: MarginfiProgram,
  marginfiAccountPk: PublicKey,
  endIndex: number,
  authority?: PublicKey,
  isSync?: boolean
): Promise<InstructionsWrapper> {
  const ix =
    isSync && authority
      ? syncInstructions.makeBeginFlashLoanIx(
          program.programId,
          {
            marginfiAccount: marginfiAccountPk,
            authority,
          },
          { endIndex: new BN(endIndex) }
        )
      : await instructions.makeBeginFlashLoanIx(
          program,
          {
            marginfiAccount: marginfiAccountPk,
            authority,
          },
          { endIndex: new BN(endIndex) }
        );
  return { instructions: [ix], keys: [] };
}

export async function makeEndFlashLoanIx(
  program: MarginfiProgram,
  marginfiAccountPk: PublicKey,
  projectedActiveBanks: BankType[],
  authority?: PublicKey,
  isSync?: boolean
): Promise<InstructionsWrapper> {
  const remainingAccounts = computeHealthAccountMetas(projectedActiveBanks);
  const ix =
    isSync && authority
      ? syncInstructions.makeEndFlashLoanIx(
          program.programId,
          {
            marginfiAccount: marginfiAccountPk,
            authority,
          },
          remainingAccounts.map((account) => ({
            pubkey: account,
            isSigner: false,
            isWritable: false,
          }))
        )
      : await instructions.makeEndFlashLoanIx(
          program,
          {
            marginfiAccount: marginfiAccountPk,
            authority,
          },
          remainingAccounts.map((account) => ({
            pubkey: account,
            isSigner: false,
            isWritable: false,
          }))
        );
  return { instructions: [ix], keys: [] };
}

export async function makeFlashLoanTx({
  program,
  marginfiAccount,
  ixs,
  bankMap,
  blockhash,
  addressLookupTableAccounts,
  signers,
  isSync,
}: MakeFlashLoanTxParams) {
  const endIndex = ixs.length + 1;

  const projectedActiveBanksKeys: PublicKey[] = computeProjectedActiveBanksNoCpi(
    marginfiAccount.balances,
    ixs,
    program
  );

  const projectedActiveBanks = projectedActiveBanksKeys.map((account) => {
    const b = bankMap.get(account.toBase58());
    if (!b) throw Error(`Bank ${account.toBase58()} not found, in makeFlashLoanTx function`);
    return b;
  });

  const beginFlashLoanIx = await makeBeginFlashLoanIx(
    program,
    marginfiAccount.address,
    endIndex,
    marginfiAccount.authority,
    isSync
  );
  const endFlashLoanIx = await makeEndFlashLoanIx(
    program,
    marginfiAccount.address,
    projectedActiveBanks,
    marginfiAccount.authority,
    isSync
  );

  const message = new TransactionMessage({
    payerKey: marginfiAccount.authority,
    recentBlockhash: blockhash,
    instructions: [...beginFlashLoanIx.instructions, ...ixs, ...endFlashLoanIx.instructions],
  }).compileToV0Message(addressLookupTableAccounts);

  const tx = addTransactionMetadata(new VersionedTransaction(message), {
    addressLookupTables: addressLookupTableAccounts,
    type: TransactionType.FLASHLOAN,
    signers: signers,
  });

  if (signers) {
    tx.sign(signers);
  }

  return tx;
}
