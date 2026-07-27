import { BigNumber } from "bignumber.js";
import {
  AddressLookupTableAccount,
  Connection,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";

import { AssetTag, BankType, requireBank, requireTokenProgram } from "~/services/bank";
import {
  OraclePrice,
  makeRefreshKaminoBanksIxs,
  makeSmartCrankSwbFeedIx,
  makeUpdateJupLendRateIxs,
} from "~/services/price";
import {
  addTransactionMetadata,
  ExtendedV0Transaction,
  splitInstructionsToFitTransactions,
  TransactionType,
} from "~/services/transaction";
import { MAX_ACCOUNT_LOCKS, MAX_TX_SIZE } from "~/constants";
import { MarginfiProgram, BankIntegrationMetadataMap } from "~/types";

import { MakeBulkRepayTxParams, MakeBulkWithdrawTxParams, BulkLendTxsResult } from "../types";
import { MarginfiAccountType } from "../types/account.types";
import {
  computeHealthAccountMetas,
  computeHealthCheckAccounts,
  computeQuantityUi,
  computeV0TxSize,
} from "../utils";

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

/** One position's built instructions plus the metadata packing needs. */
interface BuiltLeg {
  bank: BankType;
  instructions: TransactionInstruction[];
}

// computeV0TxSize can throw a RangeError for a message that overflows the
// compact-array encoding; treat that as "does not fit".
function computeV0TxSizeSafe(
  ixs: TransactionInstruction[],
  payer: PublicKey,
  luts: AddressLookupTableAccount[]
): { size: number; accountCount: number } {
  try {
    return computeV0TxSize(ixs, payer, luts);
  } catch {
    return { size: Number.MAX_SAFE_INTEGER, accountCount: Number.MAX_SAFE_INTEGER };
  }
}

function fitsInTx(
  ixs: TransactionInstruction[],
  payer: PublicKey,
  luts: AddressLookupTableAccount[]
): boolean {
  const { size, accountCount } = computeV0TxSizeSafe(ixs, payer, luts);
  return size <= MAX_TX_SIZE - BULK_TX_SIZE_MARGIN && accountCount <= MAX_ACCOUNT_LOCKS;
}

/**
 * Per-transaction integration refreshes for the banks withdrawn in that tx:
 * Kamino reserves + obligations must be refreshed in the same transaction
 * (before the mutation); JupLend withdraws self-refresh their own bank, so
 * only the *other* active JupLend banks (which appear in health packs) need
 * the permissionless rate crank.
 */
function buildTxRefreshIxs(args: {
  marginfiAccount: MarginfiAccountType;
  bankMap: Map<string, BankType>;
  bankMetadataMap: BankIntegrationMetadataMap;
  txBanks: BankType[];
}): TransactionInstruction[] {
  const { marginfiAccount, bankMap, bankMetadataMap, txBanks } = args;
  const ixs: TransactionInstruction[] = [];

  const kaminoPks = txBanks
    .filter((b) => b.config.assetTag === AssetTag.KAMINO)
    .map((b) => b.address);
  if (kaminoPks.length > 0) {
    ixs.push(
      ...makeRefreshKaminoBanksIxs(marginfiAccount, bankMap, kaminoPks, bankMetadataMap)
        .instructions
    );
  }

  const jupPksInTx = txBanks
    .filter((b) => b.config.assetTag === AssetTag.JUPLEND)
    .map((b) => b.address);
  if (jupPksInTx.length > 0) {
    ixs.push(
      ...makeUpdateJupLendRateIxs(marginfiAccount, bankMap, jupPksInTx, bankMetadataMap)
        .instructions
    );
  }

  return ixs;
}

/**
 * Withdraw the FULL position of every given bank, packing as many withdraws
 * per transaction as fit the size/lock limits. Venue dispatch (Kamino /
 * JupLend / Drift / standard) and the per-instruction health packs live here:
 * each withdraw's remaining accounts exclude every bank already closed by the
 * withdraws before it — across the whole ordered batch — because the on-chain
 * health check runs against the account's live (shrinking) balance set.
 *
 * Returns `[ATA setup txs…, crank tx?, withdraw txs…]` ordered for sequential
 * execution; `actionTxIndex` points at the first withdraw tx.
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
    overrideInferAccounts,
  } = params;
  const luts = params.addressLookupTableAccounts ?? [];
  const groupRateLimiterEnabled = params.groupRateLimiterEnabled ?? false;
  const authority = marginfiAccount.authority;

  if (bankAddresses.length === 0) throw new Error("no banks to withdraw");

  const activeBalances = marginfiAccount.balances.filter((b) => b.active);

  // Build every position's instructions once. The health pack of withdraw N
  // excludes every bank withdrawn before it (plus itself — full withdrawals
  // close the balance), mirroring what the account looks like on-chain when
  // that instruction executes. Tx boundaries don't change the packs.
  const legs: BuiltLeg[] = [];
  const withdrawnSoFar: PublicKey[] = [];

  for (const bankAddress of bankAddresses) {
    const bank = requireBank(bankMap, bankAddress);
    const tokenProgram = requireTokenProgram(tokenProgramsByBank, bankAddress);
    const balance = activeBalances.find((b) => b.bankPk.equals(bankAddress));
    if (!balance || !balance.assetShares.gt(0)) {
      throw new Error(`no active deposit for bank ${bankAddress.toBase58()}`);
    }

    const multiplier = assetShareValueMultiplierByBank.get(bankAddress.toBase58());
    const uiAmount = computeQuantityUi(balance, bank, multiplier).assets;

    const packBanks = computeHealthCheckAccounts(
      marginfiAccount.balances,
      bankMap,
      [],
      [...withdrawnSoFar, bankAddress]
    );
    const observationBanksOverride = computeHealthAccountMetas(packBanks, true, [bank]);

    const shared = {
      program,
      bank,
      bankMap,
      tokenProgram,
      marginfiAccount,
      authority,
      bankMetadataMap,
      withdrawAll: true,
      opts: {
        createAtas: false, // ATAs are created in the prelude txs
        wrapAndUnwrapSol: true,
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
          cTokenAmount: uiAmount.div(multiplier ?? new BigNumber(1)),
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
          amount: uiAmount,
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
          amount: uiAmount,
          driftSpotMarket: driftState.spotMarketState,
          userRewards: driftState.userRewards,
        });
        instructions = withdraw.instructions;
        break;
      }
      default: {
        const withdraw = await makeWithdrawIx({
          ...shared,
          amount: uiAmount,
        });
        instructions = withdraw.instructions;
        break;
      }
    }

    legs.push({ bank, instructions });
    withdrawnSoFar.push(bankAddress);
  }

  // Greedy packing: keep appending legs to the current tx while the candidate
  // (including its per-tx integration refreshes) still fits.
  const bundles: BuiltLeg[][] = [];
  let current: BuiltLeg[] = [];
  const assembleTxIxs = (bundle: BuiltLeg[]): TransactionInstruction[] => [
    ...buildTxRefreshIxs({
      marginfiAccount,
      bankMap,
      bankMetadataMap,
      txBanks: bundle.map((l) => l.bank),
    }),
    ...bundle.flatMap((l) => l.instructions),
  ];

  for (const leg of legs) {
    const candidate = [...current, leg];
    if (current.length > 0 && !fitsInTx(assembleTxIxs(candidate), authority, luts)) {
      bundles.push(current);
      current = [leg];
    } else {
      current = candidate;
    }
  }
  if (current.length > 0) bundles.push(current);

  // A single leg that doesn't fit on its own can't be split further.
  for (const bundle of bundles) {
    const ixs = assembleTxIxs(bundle);
    if (bundle.length === 1 && !fitsInTx(ixs, authority, luts)) {
      throw new Error(
        `withdraw for bank ${bundle[0].bank.address.toBase58()} does not fit one transaction`
      );
    }
  }

  const { blockhash } = await connection.getLatestBlockhash("confirmed");

  const withdrawTxs: ExtendedV0Transaction[] = bundles.map((bundle) => {
    const message = new TransactionMessage({
      payerKey: authority,
      recentBlockhash: blockhash,
      instructions: assembleTxIxs(bundle),
    }).compileToV0Message(luts);
    return addTransactionMetadata(new VersionedTransaction(message), {
      addressLookupTables: luts,
      type: TransactionType.WITHDRAW,
    });
  });

  // Prelude: ATAs for every withdrawn mint, then one deduped smart crank for
  // every switchboard feed the withdraws' health packs (and, with the group
  // rate limiter, the withdrawn banks themselves) require.
  const additionalTxs: ExtendedV0Transaction[] = [];

  const setupIxs = await makeSetupIx({
    connection,
    authority,
    tokens: legs.map((l) => ({
      mint: l.bank.mint,
      tokenProgram: requireTokenProgram(tokenProgramsByBank, l.bank.address),
    })),
  });
  if (setupIxs.length > 0) {
    const setupTxs = splitInstructionsToFitTransactions([], setupIxs, {
      blockhash,
      payerKey: authority,
      luts,
    });
    additionalTxs.push(
      ...setupTxs.map((tx) =>
        addTransactionMetadata(tx, {
          type: TransactionType.CREATE_ATA,
          addressLookupTables: luts,
        })
      )
    );
  }

  const { instructions: crankIxs, luts: feedLuts } = await makeSmartCrankSwbFeedIx({
    marginfiAccount,
    bankMap,
    oraclePrices,
    assetShareValueMultiplierByBank,
    instructions: legs.flatMap((l) => l.instructions),
    program,
    connection,
    crossbarUrl: params.crossbarUrl,
    groupRateLimiterEnabled,
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

  return {
    transactions: [...additionalTxs, ...withdrawTxs],
    actionTxIndex: additionalTxs.length,
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

  const legs: BuiltLeg[] = [];
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
    legs.push({ bank, instructions: repay.instructions });
  }

  const bundles: BuiltLeg[][] = [];
  let current: BuiltLeg[] = [];
  for (const leg of legs) {
    const candidate = [...current, leg];
    const candidateIxs = candidate.flatMap((l) => l.instructions);
    if (current.length > 0 && !fitsInTx(candidateIxs, authority, luts)) {
      bundles.push(current);
      current = [leg];
    } else {
      current = candidate;
    }
  }
  if (current.length > 0) bundles.push(current);

  const { blockhash } = await connection.getLatestBlockhash("confirmed");

  const transactions = bundles.map((bundle) => {
    const message = new TransactionMessage({
      payerKey: authority,
      recentBlockhash: blockhash,
      instructions: bundle.flatMap((l) => l.instructions),
    }).compileToV0Message(luts);
    return addTransactionMetadata(new VersionedTransaction(message), {
      addressLookupTables: luts,
      type: TransactionType.REPAY,
    });
  });

  return { transactions, actionTxIndex: 0 };
}
