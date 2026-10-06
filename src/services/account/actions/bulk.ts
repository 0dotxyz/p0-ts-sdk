import type { Address, Instruction } from "@solana/kit";

import { MakeBulkRepayTxParams, MakeBulkWithdrawTxParams, BulkLendTxsResult } from "../types";
import { computeQuantityUi, needsPremiumRefresh } from "../utils";

import { makePremiumRefreshIxs, makeSetupIx } from "./account-lifecycle";
import { makeRepayIx } from "./repay";
import { makeWithdrawIx } from "./withdraw";

import { MAX_ACCOUNT_LOCKS, WSOL_MINT } from "~/constants";
import { requireBank, requireTokenProgram } from "~/services/bank";
import { makeRefreshIntegrationBanksIxs } from "~/services/price";
import {
  makePreludeTxs,
  makeUnwrapSolIx,
  selectLutsForBanks,
  SolanaTransaction,
  splitInstructionsToFitTransactions,
  TransactionType,
} from "~/services/transaction";

/** Safety margin (bytes) below the hard cap, reserving room for the send
 *  pipeline's compute-budget / priority-fee instructions. */
const BULK_TX_SIZE_MARGIN = 128;

/**
 * Withdraw the FULL position of every given bank, packing as many withdraws
 * per transaction as fit the size/lock limits. Venue dispatch (Kamino /
 * JupLend / Drift / standard) and the per-instruction health packs live here:
 * each withdraw's remaining accounts exclude every bank already closed by the
 * withdraws before it — across the whole ordered batch — because the on-chain
 * health check runs against the account's live (shrinking) balance set.
 *
 * The returned transactions MUST land as one atomic Jito bundle (same slot,
 * sequential): the integration refreshes (Kamino reserves + obligations, rate
 * cranks) live in a single prelude tx rather than in each withdraw tx, and
 * Klend's slot-based staleness checks only stay satisfied when the withdraws
 * execute in the refresh's slot.
 *
 * Returns `[ATA setup txs…, crank tx?, refresh tx?, withdraw txs…]`;
 * `actionTxIndex` points at the first withdraw tx.
 */
export async function makeBulkWithdrawTx(
  params: MakeBulkWithdrawTxParams
): Promise<BulkLendTxsResult> {
  const {
    programAddress,
    authority,
    rpc,
    marginfiAccount,
    bankAddresses,
    bankMap,
    bankMetadataMap,
    tokenProgramsByBank,
    txFormat,
  } = params;

  if (bankAddresses.length === 0) throw new Error("no banks to withdraw");

  const activeBalances = marginfiAccount.balances.filter((b) => b.active);

  // Every bank the withdraw txs touch: the withdrawn banks + the account's active positions
  const involvedBanks = [
    ...bankAddresses.map((pk) => requireBank(bankMap, pk)),
    ...activeBalances.flatMap((b) => bankMap.get(b.bankPk) ?? []),
  ];
  const selectedFormat = selectLutsForBanks(txFormat, involvedBanks);

  // Build every position's instructions once. Withdraw N sees the account without
  // the banks withdrawn before it (the builder drops its own bank: a withdraw-all
  // closes it), mirroring the account on-chain when that instruction executes.
  // Tx boundaries don't change the packs.
  const withdrawIxs: Instruction[] = [];
  const setupTokens: { mint: Address; tokenProgram: Address }[] = [];
  const withdrawnSoFar: Address[] = [];

  for (const bankAddress of bankAddresses) {
    const bank = requireBank(bankMap, bankAddress);
    const tokenProgram = requireTokenProgram(tokenProgramsByBank, bankAddress);
    const balance = activeBalances.find((b) => b.bankPk === bankAddress);
    if (!balance || !balance.assetShares.gt(0)) {
      throw new Error(`no active deposit for bank ${bankAddress}`);
    }

    withdrawIxs.push(
      ...(await makeWithdrawIx({
        programAddress,
        bank,
        bankMap,
        tokenProgram,
        marginfiAccount,
        authority,
        bankMetadataMap,
        // every venue's withdraw ix ignores the amount when the withdraw-all flag is
        // set and derives the full position on-chain, so all legs pass amount 0
        amount: 0,
        withdrawAll: true,
        opts: {
          createAtas: false, // ATAs are created in the prelude txs
          wrapAndUnwrapSol: false, // one unwrap ix is appended after the last withdraw
          activeBanks: activeBalances
            .map((b) => b.bankPk)
            .filter((pk) => !withdrawnSoFar.includes(pk)),
        },
      }))
    );

    setupTokens.push({ mint: bank.mint, tokenProgram });
    withdrawnSoFar.push(bankAddress);
  }

  // One unwrap after the last withdraw covers every SOL position (closes the wSOL ata)
  if (setupTokens.some((t) => t.mint === WSOL_MINT)) {
    withdrawIxs.push(await makeUnwrapSolIx(authority));
  }

  const { value: latestBlockhash } = await rpc
    .getLatestBlockhash({ commitment: "confirmed" })
    .send();

  const withdrawTxs: SolanaTransaction[] = splitInstructionsToFitTransactions([], withdrawIxs, {
    latestBlockhash,
    feePayer: authority,
    txFormat: selectedFormat,
    sizeMargin: BULK_TX_SIZE_MARGIN,
    maxAccountLocks: MAX_ACCOUNT_LOCKS,
  }).map((message) => ({ message, type: TransactionType.WITHDRAW }));

  // Prelude: ATAs for every withdrawn mint, then one shared integration-refresh
  // tx for the whole batch (see the atomic-bundle note in the doc comment).
  const setupIxs = await makeSetupIx({
    rpc,
    authority,
    tokens: setupTokens,
  });

  // One shared refresh for the whole batch: kamino reserves + obligations for
  // the withdrawn kamino banks, rate cranks for the account's other jup/drift
  // banks (the withdrawn ones self-update via CPI in their withdraw ix).
  const refreshIxs = await makeRefreshIntegrationBanksIxs(
    marginfiAccount,
    bankMap,
    bankAddresses,
    bankMetadataMap
  );
  const additionalTxs = makePreludeTxs(setupIxs, refreshIxs, {
    latestBlockhash,
    feePayer: authority,
    txFormat: selectedFormat,
  });

  return {
    transactions: [...additionalTxs, ...withdrawTxs],
    actionTxIndex: additionalTxs.length,
    mustBeAtomicBundle: refreshIxs.length > 0,
  };
}

/**
 * Repay the FULL debt of every given bank from the wallet, packing as many
 * repays per transaction as fit, followed by the premium refresh while
 * premium-bearing debt remains. Most batches are a single transaction; one
 * that splits with a premium refresh in it must land as one bundle.
 */
export async function makeBulkRepayTx(params: MakeBulkRepayTxParams): Promise<BulkLendTxsResult> {
  const {
    programAddress,
    authority,
    rpc,
    marginfiAccount,
    bankAddresses,
    bankMap,
    tokenProgramsByBank,
    txFormat,
  } = params;

  if (bankAddresses.length === 0) throw new Error("no banks to repay");

  const activeBalances = marginfiAccount.balances.filter((b) => b.active);

  const repayIxs: Instruction[] = [];
  for (const bankAddress of bankAddresses) {
    const bank = requireBank(bankMap, bankAddress);
    const tokenProgram = requireTokenProgram(tokenProgramsByBank, bankAddress);
    const balance = activeBalances.find((b) => b.bankPk === bankAddress);
    if (!balance || !balance.liabilityShares.gt(0)) {
      throw new Error(`no active debt for bank ${bankAddress}`);
    }
    const uiAmount = computeQuantityUi(balance, bank).liabilities;

    repayIxs.push(
      ...(await makeRepayIx({
        programAddress,
        bank,
        tokenProgram,
        amount: uiAmount,
        marginfiAccount,
        authority,
        repayAll: true,
        opts: {
          wrapAndUnwrapSol: true,
        },
      }))
    );
  }

  const premiumIxs =
    !params.skipPremiumRefresh && needsPremiumRefresh(marginfiAccount, bankMap, bankAddresses)
      ? await makePremiumRefreshIxs(
          programAddress,
          { marginfiAccount, bankMap, bankMetadataMap: params.bankMetadataMap },
          [],
          bankAddresses
        )
      : [];

  const { value: latestBlockhash } = await rpc
    .getLatestBlockhash({ commitment: "confirmed" })
    .send();

  const transactions = splitInstructionsToFitTransactions([], [...repayIxs, ...premiumIxs], {
    latestBlockhash,
    feePayer: authority,
    txFormat,
    sizeMargin: BULK_TX_SIZE_MARGIN,
    maxAccountLocks: MAX_ACCOUNT_LOCKS,
  }).map((message) => ({ message, type: TransactionType.REPAY }));

  return {
    transactions,
    actionTxIndex: 0,
    // Venue refreshes only count in the pulse's slot, and the pulse must follow every repay
    mustBeAtomicBundle: premiumIxs.length > 0 && transactions.length > 1,
  };
}
