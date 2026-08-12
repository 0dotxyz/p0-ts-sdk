import {
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";

import { AssetTag, requireBank, requireTokenProgram } from "~/services/bank";
import { makeRefreshIntegrationBanksIxs, makeSmartCrankSwbFeedIx } from "~/services/price";
import {
  addTransactionMetadata,
  ExtendedV0Transaction,
  makeUnwrapSolIx,
  selectLutsForBanks,
  splitInstructionsToFitTransactions,
  TransactionType,
} from "~/services/transaction";
import { NATIVE_MINT } from "~/vendor/spl";
import { MAX_ACCOUNT_LOCKS } from "~/constants";
import { MakeBulkRepayTxParams, MakeBulkWithdrawTxParams, BulkLendTxsResult } from "../types";
import { computeHealthAccountMetas, computeHealthCheckAccounts, computeQuantityUi } from "../utils";

import {
  makeWithdrawIx,
  makeKaminoWithdrawIx,
  makeJuplendWithdrawIx,
  makeDriftWithdrawIx,
} from "./withdraw";
import { makeRepayIx } from "./repay";
import { makeSetupIx } from "./account-lifecycle";

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
    program,
    connection,
    marginfiAccount,
    bankAddresses,
    bankMap,
    bankMetadataMap,
    oraclePrices,
    assetShareValueMultiplierByBank,
    tokenProgramsByBank,
    groupRateLimiterEnabled = false,
    overrideInferAccounts,
    luts,
  } = params;

  const authority = marginfiAccount.authority;

  if (bankAddresses.length === 0) throw new Error("no banks to withdraw");

  const activeBalances = marginfiAccount.balances.filter((b) => b.active);

  // Every bank the withdraw txs touch: the withdrawn banks + the account's active positions
  const involvedBanks = [
    ...bankAddresses.map((pk) => requireBank(bankMap, pk)),
    ...activeBalances.flatMap((b) => bankMap.get(b.bankPk.toBase58()) ?? []),
  ];
  const selectedLuts = selectLutsForBanks(luts, involvedBanks);

  // Build every position's instructions once. The health pack of withdraw N
  // excludes every bank withdrawn before it (plus itself — full withdrawals
  // close the balance), mirroring what the account looks like on-chain when
  // that instruction executes. Tx boundaries don't change the packs.
  const withdrawIxs: TransactionInstruction[] = [];
  const setupTokens: { mint: PublicKey; tokenProgram: PublicKey }[] = [];
  const withdrawnSoFar: PublicKey[] = [];

  for (const bankAddress of bankAddresses) {
    const bank = requireBank(bankMap, bankAddress);
    const tokenProgram = requireTokenProgram(tokenProgramsByBank, bankAddress);
    const balance = activeBalances.find((b) => b.bankPk.equals(bankAddress));
    if (!balance || !balance.assetShares.gt(0)) {
      throw new Error(`no active deposit for bank ${bankAddress.toBase58()}`);
    }

    const packBanks = computeHealthCheckAccounts({
      account: marginfiAccount,
      banksMap: bankMap,
      excludedBanks: [...withdrawnSoFar, bankAddress],
    });
    const observationBanksOverride = computeHealthAccountMetas({
      banksToInclude: packBanks,
      trailingBanks: [bank],
    });

    const shared = {
      program,
      bank,
      bankMap,
      tokenProgram,
      marginfiAccount,
      authority,
      bankMetadataMap,
      // every venue's withdraw ix ignores the amount when the withdraw-all flag is
      // set and derives the full position on-chain, so all legs pass amount 0
      withdrawAll: true,
      opts: {
        createAtas: false, // ATAs are created in the prelude txs
        wrapAndUnwrapSol: false, // one unwrap ix is appended after the last withdraw
        overrideInferAccounts,
        observationBanksOverride,
      },
    };

    let instructions: TransactionInstruction[];
    switch (bank.config.assetTag) {
      case AssetTag.KAMINO: {
        const reserve = bankMetadataMap[bankAddress.toBase58()]?.kaminoStates?.reserveState;
        if (!reserve) {
          throw new Error(`kamino reserve state missing for bank ${bankAddress.toBase58()}`);
        }
        const withdraw = await makeKaminoWithdrawIx({
          ...shared,
          cTokenAmount: 0,
          reserve,
        });
        instructions = withdraw.instructions;
        break;
      }
      case AssetTag.JUPLEND: {
        const jupLendingState =
          bankMetadataMap[bankAddress.toBase58()]?.jupLendStates?.jupLendingState;
        if (!jupLendingState) {
          throw new Error(`juplend lending state missing for bank ${bankAddress.toBase58()}`);
        }
        const withdraw = await makeJuplendWithdrawIx({
          ...shared,
          amount: 0,
          jupLendingState,
        });
        instructions = withdraw.instructions;
        break;
      }
      case AssetTag.DRIFT: {
        const driftState = bankMetadataMap[bankAddress.toBase58()]?.driftStates;
        if (!driftState) {
          throw new Error(`drift state missing for bank ${bankAddress.toBase58()}`);
        }
        const withdraw = await makeDriftWithdrawIx({
          ...shared,
          amount: 0,
          driftSpotMarket: driftState.spotMarketState,
          userRewards: driftState.userRewards,
        });
        instructions = withdraw.instructions;
        break;
      }
      default: {
        const withdraw = await makeWithdrawIx({
          ...shared,
          amount: 0,
        });
        instructions = withdraw.instructions;
        break;
      }
    }

    withdrawIxs.push(...instructions);
    setupTokens.push({ mint: bank.mint, tokenProgram });
    withdrawnSoFar.push(bankAddress);
  }

  // One unwrap after the last withdraw covers every SOL position (closes the wSOL ata)
  if (setupTokens.some((t) => t.mint.equals(NATIVE_MINT))) {
    withdrawIxs.push(makeUnwrapSolIx(authority));
  }

  const { blockhash } = await connection.getLatestBlockhash("confirmed");

  const withdrawTxs: ExtendedV0Transaction[] = splitInstructionsToFitTransactions([], withdrawIxs, {
    blockhash,
    payerKey: authority,
    luts: selectedLuts,
    sizeMargin: BULK_TX_SIZE_MARGIN,
    maxAccountLocks: MAX_ACCOUNT_LOCKS,
  }).map((tx) =>
    addTransactionMetadata(tx, {
      addressLookupTables: selectedLuts,
      type: TransactionType.WITHDRAW,
    })
  );

  // Prelude: ATAs for every withdrawn mint, then one deduped smart crank for
  // every switchboard feed the withdraws' health packs (and, with the group
  // rate limiter, the withdrawn banks themselves) require, then one shared
  // integration-refresh tx for the whole batch (see the atomic-bundle note
  // in the doc comment).
  const additionalTxs: ExtendedV0Transaction[] = [];

  const setupIxs = await makeSetupIx({
    connection,
    authority,
    tokens: setupTokens,
  });
  if (setupIxs.length > 0) {
    const setupTxs = splitInstructionsToFitTransactions([], setupIxs, {
      blockhash,
      payerKey: authority,
      luts: selectedLuts,
    });
    additionalTxs.push(
      ...setupTxs.map((tx) =>
        addTransactionMetadata(tx, {
          type: TransactionType.CREATE_ATA,
          addressLookupTables: selectedLuts,
        })
      )
    );
  }

  const { instructions: crankIxs, luts: feedLuts } = await makeSmartCrankSwbFeedIx({
    marginfiAccount,
    bankMap,
    oraclePrices,
    assetShareValueMultiplierByBank,
    instructions: withdrawIxs,
    program,
    connection,
    groupRateLimiterEnabled,
    crossbarUrl: params.crossbarUrl,
  });
  if (crankIxs.length > 0) {
    const message = new TransactionMessage({
      payerKey: authority,
      recentBlockhash: blockhash,
      instructions: crankIxs,
    }).compileToV0Message(feedLuts);
    additionalTxs.push(
      addTransactionMetadata(new VersionedTransaction(message), {
        addressLookupTables: feedLuts,
        type: TransactionType.CRANK,
      })
    );
  }

  // One shared refresh for the whole batch: kamino reserves + obligations for
  // the withdrawn kamino banks, rate cranks for the account's other jup/drift
  // banks (the withdrawn ones self-update via CPI in their withdraw ix).
  const refreshIxs = makeRefreshIntegrationBanksIxs(
    marginfiAccount,
    bankMap,
    bankAddresses,
    bankMetadataMap
  ).instructions;
  if (refreshIxs.length > 0) {
    const refreshTxs = splitInstructionsToFitTransactions([], refreshIxs, {
      blockhash,
      payerKey: authority,
      luts: selectedLuts,
    });
    additionalTxs.push(
      ...refreshTxs.map((tx) =>
        addTransactionMetadata(tx, {
          type: TransactionType.CRANK,
          addressLookupTables: selectedLuts,
        })
      )
    );
  }

  return {
    transactions: [...additionalTxs, ...withdrawTxs],
    actionTxIndex: additionalTxs.length,
    mustBeAtomicBundle: refreshIxs.length > 0,
  };
}

/**
 * Repay the FULL debt of every given bank from the wallet, packing as many
 * repays per transaction as fit. Repays carry no health pack and need no
 * oracle cranks, so most batches are a single transaction.
 */
export async function makeBulkRepayTx(params: MakeBulkRepayTxParams): Promise<BulkLendTxsResult> {
  const {
    program,
    connection,
    marginfiAccount,
    bankAddresses,
    bankMap,
    tokenProgramsByBank,
    overrideInferAccounts,
  } = params;
  const luts = params.addressLookupTableAccounts ?? [];
  const authority = marginfiAccount.authority;

  if (bankAddresses.length === 0) throw new Error("no banks to repay");

  const activeBalances = marginfiAccount.balances.filter((b) => b.active);

  const repayIxs: TransactionInstruction[] = [];
  for (const bankAddress of bankAddresses) {
    const bank = requireBank(bankMap, bankAddress);
    const tokenProgram = requireTokenProgram(tokenProgramsByBank, bankAddress);
    const balance = activeBalances.find((b) => b.bankPk.equals(bankAddress));
    if (!balance || !balance.liabilityShares.gt(0)) {
      throw new Error(`no active debt for bank ${bankAddress.toBase58()}`);
    }
    const uiAmount = computeQuantityUi(balance, bank).liabilities;

    const repay = await makeRepayIx({
      program,
      bank,
      tokenProgram,
      amount: uiAmount,
      accountAddress: marginfiAccount.address,
      authority,
      repayAll: true,
      opts: {
        wrapAndUnwrapSol: true,
        overrideInferAccounts,
      },
    });
    repayIxs.push(...repay.instructions);
  }

  const { blockhash } = await connection.getLatestBlockhash("confirmed");

  const transactions = splitInstructionsToFitTransactions([], repayIxs, {
    blockhash,
    payerKey: authority,
    luts,
    sizeMargin: BULK_TX_SIZE_MARGIN,
    maxAccountLocks: MAX_ACCOUNT_LOCKS,
  }).map((tx) =>
    addTransactionMetadata(tx, {
      addressLookupTables: luts,
      type: TransactionType.REPAY,
    })
  );

  return { transactions, actionTxIndex: 0, mustBeAtomicBundle: false };
}
