import type { Address, Instruction } from "@solana/kit";

import { MakeBulkRepayTxParams, MakeBulkWithdrawTxParams, BulkLendTxsResult } from "../types";
import { computeQuantityUi, needsPremiumRefresh } from "../utils";

import { makeCreateMissingAtaIxs, makePremiumRefreshIxs } from "./account-lifecycle";
import { makeRepayIx } from "./repay";
import { makeWithdrawIx } from "./withdraw";

import { BUNDLE_TX_SIZE, MAX_ACCOUNT_LOCKS, PRIORITY_TX_SIZE, WSOL_MINT } from "~/constants";
import { TransactionBuildingError } from "~/errors";
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

// Room for what the send pipeline appends: compute-budget and priority-fee ixs, and in bundles a
// Jito tip, which lock the ComputeBudget program, tip account and System program
const SEND_PIPELINE_ROOM = {
  sizeMargin: PRIORITY_TX_SIZE + BUNDLE_TX_SIZE,
  maxAccountLocks: MAX_ACCOUNT_LOCKS - 3,
};

// Repay-all repays the debt as of execution, a little over the snapshot it's sized from; the extra
// wrapped SOL comes back when the wSOL account is closed after the repays
const SOL_REPAY_ALL_BUFFER = 1.001;

const invalidSelection =
  (address: Address) =>
  (message: string): Error =>
    TransactionBuildingError.bulkInvalidSelection(message, [address]);

/**
 * Withdraws the full position of each of `bankAddresses`, in order, packing as many withdraws per
 * transaction as fit. Returns `[setup txs…, refresh txs…, withdraw txs…]`, `actionTxIndex` at the
 * first withdraw. With refreshes it must land as one atomic bundle (`mustBeAtomicBundle`): Kamino
 * only accepts a reserve refreshed in the same slot.
 * @throws TransactionBuildingError (BULK_INVALID_SELECTION) if `bankAddresses` is empty, repeats
 * a bank, or names a bank without a deposit
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
    groupRateLimiterEnabled,
  } = params;

  if (bankAddresses.length === 0) {
    throw TransactionBuildingError.bulkInvalidSelection("no banks to withdraw", []);
  }
  if (new Set(bankAddresses).size < bankAddresses.length) {
    throw TransactionBuildingError.bulkInvalidSelection("a bank is listed twice", bankAddresses);
  }

  const activeBalances = marginfiAccount.balances.filter((b) => b.active);

  // Every bank the withdraw txs touch: the withdrawn banks + the account's active positions
  const involvedBanks = [
    ...bankAddresses.map((pk) => requireBank(bankMap, pk, invalidSelection(pk))),
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
    const bank = requireBank(bankMap, bankAddress, invalidSelection(bankAddress));
    const tokenProgram = requireTokenProgram(
      tokenProgramsByBank,
      bankAddress,
      invalidSelection(bankAddress)
    );
    const balance = activeBalances.find((b) => b.bankPk === bankAddress);
    if (!balance || !balance.assetShares.gt(0)) {
      throw invalidSelection(bankAddress)("no deposit to withdraw");
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
          createAta: false, // ATAs are created in the prelude txs
          unwrapSol: false, // one unwrap ix is appended after the last withdraw
          activeBanks: activeBalances
            .map((b) => b.bankPk)
            .filter((pk) => !withdrawnSoFar.includes(pk)),
          groupRateLimiterEnabled,
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
    ...SEND_PIPELINE_ROOM,
  }).map((message) => ({ message, type: TransactionType.WITHDRAW }));

  const setupIxs = await makeCreateMissingAtaIxs({
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
 * Repays the full debt of each of `bankAddresses` from the wallet, packing as many repays per
 * transaction as fit, followed by the premium refresh while premium-bearing debt remains. A batch
 * that splits with the premium refresh in it must land as one bundle (`mustBeAtomicBundle`). A SOL
 * repay wraps a little extra SOL and closes the wSOL account afterwards, which also unwraps wSOL
 * already in it.
 * @throws TransactionBuildingError (BULK_INVALID_SELECTION) if `bankAddresses` is empty, repeats
 * a bank, or names a bank without debt
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

  if (bankAddresses.length === 0) {
    throw TransactionBuildingError.bulkInvalidSelection("no banks to repay", []);
  }
  if (new Set(bankAddresses).size < bankAddresses.length) {
    throw TransactionBuildingError.bulkInvalidSelection("a bank is listed twice", bankAddresses);
  }

  const activeBalances = marginfiAccount.balances.filter((b) => b.active);

  const repayIxs: Instruction[] = [];
  let repaysSol = false;
  for (const bankAddress of bankAddresses) {
    const bank = requireBank(bankMap, bankAddress, invalidSelection(bankAddress));
    const tokenProgram = requireTokenProgram(
      tokenProgramsByBank,
      bankAddress,
      invalidSelection(bankAddress)
    );
    const balance = activeBalances.find((b) => b.bankPk === bankAddress);
    if (!balance || !balance.liabilityShares.gt(0)) {
      throw invalidSelection(bankAddress)("no debt to repay");
    }
    const uiAmount = computeQuantityUi(balance, bank).liabilities;
    const isSol = bank.mint === WSOL_MINT;
    repaysSol ||= isSol;

    repayIxs.push(
      ...(await makeRepayIx({
        programAddress,
        bank,
        tokenProgram,
        amount: isSol ? uiAmount.times(SOL_REPAY_ALL_BUFFER) : uiAmount,
        marginfiAccount,
        authority,
        repayAll: true,
      }))
    );
  }
  if (repaysSol) {
    repayIxs.push(await makeUnwrapSolIx(authority));
  }

  const premiumIxs =
    !params.skipPremiumRefresh && needsPremiumRefresh(marginfiAccount, bankMap, bankAddresses)
      ? await makePremiumRefreshIxs({
          programAddress,
          marginfiAccount,
          bankMap,
          bankMetadataMap: params.bankMetadataMap,
          mandatoryBanks: [],
          excludedBanks: bankAddresses,
        })
      : [];

  const { value: latestBlockhash } = await rpc
    .getLatestBlockhash({ commitment: "confirmed" })
    .send();

  const transactions = splitInstructionsToFitTransactions([], [...repayIxs, ...premiumIxs], {
    latestBlockhash,
    feePayer: authority,
    txFormat,
    ...SEND_PIPELINE_ROOM,
  }).map((message) => ({ message, type: TransactionType.REPAY }));

  return {
    transactions,
    actionTxIndex: 0,
    // Venue refreshes only count in the pulse's slot, and the pulse must follow every repay
    mustBeAtomicBundle: premiumIxs.length > 0 && transactions.length > 1,
  };
}
