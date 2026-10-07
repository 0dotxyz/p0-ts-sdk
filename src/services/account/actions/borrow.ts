import type { Instruction } from "@solana/kit";
import {
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstruction,
} from "@solana-program/token";

import { MakeBorrowIxParams, MakeBorrowTxParams } from "../types";
import { computeHealthAccounts, getActiveBalances } from "../utils";

import { WSOL_MINT } from "~/constants";
import instructions from "~/instructions";
import { makeRefreshIntegrationBanksIxs } from "~/services/price";
import {
  makeTransactionMessage,
  makeUnwrapSolIx,
  selectLutsForAccountAction,
  SolanaTransaction,
  TransactionType,
} from "~/services/transaction";
import { uiToNative } from "~/utils";

/**
 * Borrows `amount` (UI units of the bank's mint) from `bank` into the authority's ATA. Creates the
 * ATA and unwraps wSOL unless `opts` disables it; unwrapping closes the wSOL ATA, so wSOL already
 * in it is unwrapped too.
 * @throws TransactionBuildingError (BANK_NOT_FOUND) if `bankMap` misses one of the account's
 * active banks
 */
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
  const borrowIxs: Instruction[] = [];

  const [destinationTokenAccount] = await findAssociatedTokenPda({
    mint: bank.mint,
    owner: authority.address,
    tokenProgram,
  });

  if (opts.createAta ?? true) {
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

  const activeBanks =
    opts.activeBanks ?? getActiveBalances(marginfiAccount.balances).map((b) => b.bankPk);

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
        mint: bank.mint,
        tokenProgram,
        amount: uiToNative(amount, bank.mintDecimals),
      },
      computeHealthAccounts(bankMap, [...activeBanks, bank.address])
    )
  );

  if (bank.mint === WSOL_MINT && (opts.unwrapSol ?? true)) {
    borrowIxs.push(await makeUnwrapSolIx(authority));
  }

  return borrowIxs;
}

/**
 * Builds a borrow transaction around {@link makeBorrowIx}, preceded by the refreshes of the
 * account's integration banks, including those `opts.activeBanks` adds. The authority pays and
 * signs; `latestBlockhash` is fetched when omitted.
 * @throws see {@link makeBorrowIx}
 * @throws TransactionBuildingError (KAMINO_RESERVE_NOT_FOUND, DRIFT_STATE_NOT_FOUND or
 * JUPLEND_STATE_NOT_FOUND) if an integration bank's venue state is missing from `bankMetadataMap`
 */
export async function makeBorrowTx(params: MakeBorrowTxParams): Promise<SolanaTransaction> {
  const { rpc, txFormat, latestBlockhash, bankMetadataMap, ...borrowIxParams } = params;
  const { bank, bankMap, marginfiAccount, opts } = params;

  const borrowIxs = await makeBorrowIx(borrowIxParams);

  // A Kamino bank opened earlier in the bundle still needs its reserve refreshed; Drift and
  // JupLend deposits update their venue themselves
  const accountBanks = getActiveBalances(marginfiAccount.balances).map((b) => b.bankPk);
  const openedBanks = (opts?.activeBanks ?? []).filter((b) => !accountBanks.includes(b));
  const refreshIxs = await makeRefreshIntegrationBanksIxs(
    marginfiAccount,
    bankMap,
    [bank.address],
    bankMetadataMap,
    [bank.address, ...openedBanks]
  );

  return {
    message: makeTransactionMessage({
      instructions: [...refreshIxs, ...borrowIxs],
      feePayer: params.authority,
      latestBlockhash:
        latestBlockhash ?? (await rpc.getLatestBlockhash({ commitment: "confirmed" }).send()).value,
      txFormat: selectLutsForAccountAction(
        txFormat,
        bank,
        marginfiAccount.balances,
        bankMap,
        opts?.activeBanks
      ),
    }),
    type: TransactionType.BORROW,
  };
}
