import { AccountRole, type Instruction } from "@solana/kit";
import {
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstruction,
} from "@solana-program/token";

import { MakeBorrowIxParams, MakeBorrowTxParams, TransactionBuilderResult } from "../types";
import { computeHealthAccountMetas, computeHealthCheckAccounts } from "../utils";

import { TOKEN_2022_PROGRAM_ID, WSOL_MINT } from "~/constants";
import instructions from "~/instructions";
import { makeRefreshIntegrationBanksIxs } from "~/services/price";
import {
  makeTransactionMessage,
  makeUnwrapSolIx,
  selectLutsForAccountAction,
  TransactionType,
} from "~/services/transaction";
import { uiToNative } from "~/utils";

export async function makeBorrowIx({
  programAddress,
  bank,
  bankMap,
  tokenProgram,
  amount,
  marginfiAccount,
  authority,
  opts = {},
}: MakeBorrowIxParams): Promise<Instruction[]> {
  const wrapAndUnwrapSol = opts.wrapAndUnwrapSol ?? true;
  const createAtas = opts.createAtas ?? true;
  const borrowIxs: Instruction[] = [];

  // We allow off curve addresses here to support Fuse.
  const [destinationTokenAccount] = await findAssociatedTokenPda({
    mint: bank.mint,
    owner: authority.address,
    tokenProgram,
  });

  if (createAtas) {
    borrowIxs.push(
      getCreateAssociatedTokenIdempotentInstruction({
        payer: authority,
        ata: destinationTokenAccount,
        owner: authority.address,
        mint: bank.mint,
        tokenProgram,
      })
    );
  }

  // Combine the borrow bank with any additional health check banks
  // (e.g., deposit bank in a combined deposit-borrow operation)
  const healthAccounts = computeHealthCheckAccounts({
    account: marginfiAccount,
    banksMap: bankMap,
    mandatoryBanks: [bank.address, ...(opts.additionalHealthCheckBanks ?? [])],
  });

  const remainingAccounts = tokenProgram === TOKEN_2022_PROGRAM_ID ? [bank.mint] : [];
  remainingAccounts.push(
    ...(opts.observationBanksOverride ??
      computeHealthAccountMetas({ banksToInclude: healthAccounts }))
  );

  borrowIxs.push(
    await instructions.makeBorrowIx(
      programAddress,
      {
        group: marginfiAccount.group,
        marginfiAccount: marginfiAccount.address,
        authority,
        bank: bank.address,
        destinationTokenAccount,
        liquidityVault: bank.liquidityVault,
        tokenProgram,
        amount: uiToNative(amount, bank.mintDecimals),
      },
      remainingAccounts.map((address) => ({ address, role: AccountRole.READONLY }))
    )
  );

  if (bank.mint === WSOL_MINT && wrapAndUnwrapSol) {
    borrowIxs.push(await makeUnwrapSolIx(authority));
  }

  return borrowIxs;
}

export async function makeBorrowTx(params: MakeBorrowTxParams): Promise<TransactionBuilderResult> {
  const { rpc, luts, latestBlockhash, bankMetadataMap, ...borrowIxParams } = params;

  const refreshIntegrationIxs = await makeRefreshIntegrationBanksIxs(
    params.marginfiAccount,
    params.bankMap,
    [params.bank.address],
    bankMetadataMap
  );

  const borrowIxs = await makeBorrowIx(borrowIxParams);

  const borrowTx = {
    message: makeTransactionMessage({
      instructions: [...refreshIntegrationIxs, ...borrowIxs],
      feePayer: params.authority,
      latestBlockhash:
        latestBlockhash ?? (await rpc.getLatestBlockhash({ commitment: "confirmed" }).send()).value,
      // Pick the lean native-stake LUT subset when every involved bank (target + the
      // account's active positions + any extra health-check banks) is STAKED/SOL.
      luts: selectLutsForAccountAction(
        luts,
        params.bank,
        params.marginfiAccount.balances,
        params.bankMap,
        params.opts?.additionalHealthCheckBanks
      ),
    }),
    type: TransactionType.BORROW,
  };

  return { transactions: [borrowTx], actionTxIndex: 0 };
}
