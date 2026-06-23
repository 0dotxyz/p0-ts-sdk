import BN from "bn.js";
import {
  AddressLookupTableAccount,
  ComputeBudgetProgram,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";

import {
  addTransactionMetadata,
  ExtendedV0Transaction,
  getTxSize,
  getTotalAccountKeys,
  InstructionsWrapper,
  splitInstructionsToFitTransactions,
  TransactionType,
} from "~/services/transaction";
import { makeSmartCrankSwbFeedIx } from "~/services/price";
import { TransactionBuildingError } from "~/errors";
import { MAX_TX_SIZE, MAX_ACCOUNT_LOCKS } from "~/constants";
import {
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
  TOKEN_PROGRAM_ID,
} from "~/vendor/spl";
import {
  ExponentMergeAccounts,
  makeExponentMergeIx,
  makeExponentStripIx,
  resolveExponentMergeContext,
  resolveExponentStripContext,
} from "~/vendor/exponent";
import { uiToNative } from "~/utils";

import { isWholePosition, patchDepositAmount, isDepositIx } from "../utils";
import { MakeRollPtTxParams, SwapQuoteResult } from "../types";

import { makeSetupIx } from "./account-lifecycle";
import { makeWithdrawIx } from "./withdraw";
import { makeDepositIx } from "./deposit";
import { makeFlashLoanTx } from "./flash-loan";

const DEFAULT_ROLL_SLIPPAGE_BPS = 10;

/** Everything {@link resolveRoll} works out from the high-level `rollOpts` config. */
interface ResolvedRoll {
  actualWithdrawAmount: number;
  isFullWithdraw: boolean;
  /** Resolved Exponent `merge` accounts for the matured vault. */
  mergeAccounts: ExponentMergeAccounts;
  /** The shared SY token (merge output / buy-leg input). */
  syToken: { mint: PublicKey; tokenProgram: PublicKey };
  /** SY→PT_new buy instructions (default `strip`, or `rollOpts.buy`). */
  buyInstructions: TransactionInstruction[];
  /** Buy-leg setup ixs (e.g. the new YT ATA `strip` mints into) — go in the setup tx. */
  buySetupInstructions: TransactionInstruction[];
  /** Native PT the buy delivers — the deposit amount. */
  ptOutNative: bigint;
  /** The roll's Exponent LUTs (merge vault ALT, buy ALT, PT-roll LUT). */
  rollLuts: AddressLookupTableAccount[];
}

/**
 * Resolve the high-level `rollOpts` config into concrete merge accounts + buy-leg
 * instructions + sizing + lookup tables. Mirrors how `makeLoopTx`/`makeSwapCollateralTx`
 * internalize the swap engine: the caller passes markets, this does the Exponent legwork.
 */
async function resolveRoll(params: MakeRollPtTxParams): Promise<ResolvedRoll> {
  const { connection, marginfiAccount, withdrawOpts, rollOpts } = params;
  const owner = marginfiAccount.authority;
  const slippageBps = rollOpts.slippageBps ?? DEFAULT_ROLL_SLIPPAGE_BPS;
  const keepBps = BigInt(10_000 - slippageBps);

  // Clamp the withdraw amount (mirrors the withdraw/merge sizing).
  if (withdrawOpts.withdrawAmount !== undefined && withdrawOpts.withdrawAmount <= 0) {
    throw new Error("withdrawAmount must be greater than 0");
  }
  const actualWithdrawAmount = Math.min(
    withdrawOpts.withdrawAmount ?? withdrawOpts.totalPositionAmount,
    withdrawOpts.totalPositionAmount
  );
  const isFullWithdraw = isWholePosition(
    { amount: withdrawOpts.totalPositionAmount, isLending: true },
    actualWithdrawAmount,
    withdrawOpts.withdrawBank.mintDecimals
  );

  // --- merge: PT_old → SY (always resolved internally) ---------------------------------
  if (!rollOpts.maturedMarket && !rollOpts.maturedVault) {
    throw new Error("roll-pt: rollOpts.maturedMarket or maturedVault is required");
  }
  const merge = await resolveExponentMergeContext({
    connection,
    owner,
    market: rollOpts.maturedMarket,
    vault: rollOpts.maturedVault,
  });
  const withdrawNative = BigInt(
    uiToNative(actualWithdrawAmount, withdrawOpts.withdrawBank.mintDecimals).toString()
  );
  const redeemedSy = merge.computeRedeemedAmountNative(withdrawNative);
  const syToken = { mint: merge.underlying.mint, tokenProgram: merge.underlying.tokenProgram };

  // --- buy leg: default `strip`, or the `rollOpts.buy` escape hatch ---------------------
  let buyInstructions: TransactionInstruction[];
  let buySetupInstructions: TransactionInstruction[];
  let buyLuts: AddressLookupTableAccount[];
  let ptOutNative: bigint;

  if (rollOpts.buy) {
    buyInstructions = rollOpts.buy.instructions;
    buySetupInstructions = rollOpts.buy.setupInstructions ?? [];
    buyLuts = rollOpts.buy.lookupTables ?? [];
    ptOutNative = rollOpts.buy.ptOutNative;
  } else {
    if (!rollOpts.successorVault && !rollOpts.successorMarket) {
      throw new Error(
        "roll-pt: rollOpts.successorVault or successorMarket is required (or pass rollOpts.buy)"
      );
    }
    const strip = await resolveExponentStripContext({
      connection,
      owner,
      vault: rollOpts.successorVault,
      market: rollOpts.successorMarket,
    });
    // Strip a hair under the redeemed SY so on-chain merge rounding never shorts it.
    const syIn = (redeemedSy * keepBps) / 10_000n;
    buyInstructions = [makeExponentStripIx(strip.stripAccounts, syIn)];
    // `strip` mints the new PT (deposited) + a new YT (left in the owner's wallet) — create
    // that YT ATA in the setup tx, not the flashloan.
    const ytAta = getAssociatedTokenAddressSync(strip.yt.mint, owner, true, strip.yt.tokenProgram);
    buySetupInstructions = [
      createAssociatedTokenAccountIdempotentInstruction(
        owner,
        ytAta,
        owner,
        strip.yt.mint,
        strip.yt.tokenProgram
      ),
    ];
    buyLuts = [strip.addressLookupTable];
    ptOutNative = (strip.computeStrippedPtNative(syIn) * keepBps) / 10_000n;
  }

  // Fetch the optional dedicated PT-roll LUT (compresses the strip flashloan).
  const rollLuts: AddressLookupTableAccount[] = [merge.addressLookupTable, ...buyLuts];
  if (rollOpts.lookupTable) {
    const fetched = (await connection.getAddressLookupTable(rollOpts.lookupTable)).value;
    if (!fetched) {
      throw new Error(`roll-pt: PT-roll lookup table not found: ${rollOpts.lookupTable.toBase58()}`);
    }
    rollLuts.push(fetched);
  }

  return {
    actualWithdrawAmount,
    isFullWithdraw,
    mergeAccounts: merge.mergeAccounts,
    syToken,
    buyInstructions,
    buySetupInstructions,
    ptOutNative,
    rollLuts,
  };
}

/**
 * Roll a matured Exponent PT collateral position into its next-maturity PT, in one
 * flash-loan-wrapped bundle — entirely within Exponent, no unwrap, no external swap:
 *
 *   withdraw PT_old → Exponent `merge` (PT_old → SY) → SY → PT_new buy → deposit PT_new
 *
 * The caller passes high-level config (`rollOpts`: the matured + successor markets); this
 * resolves the `merge` and (by default) builds the `strip` buy leg internally — the same
 * way `makeLoopTx`/`makeSwapCollateralTx` internalize their swap. For a non-strip venue
 * (e.g. legacy `MarketTwo` `trade_pt`), pass a pre-built buy leg via `rollOpts.buy`.
 */
export async function makeRollPtTx(params: MakeRollPtTxParams): Promise<{
  transactions: ExtendedV0Transaction[];
  actionTxIndex: number;
  quoteResponse: SwapQuoteResult | undefined;
}> {
  const {
    program,
    marginfiAccount,
    connection,
    bankMap,
    oraclePrices,
    withdrawOpts,
    depositOpts,
    assetShareValueMultiplierByBank,
    addressLookupTableAccounts,
    crossbarUrl,
  } = params;

  const resolved = await resolveRoll(params);

  const blockhash = (await connection.getLatestBlockhash("confirmed")).blockhash;

  // ATAs touched across the bundle: old PT (withdraw dest + merge pt_src), the shared SY
  // (merge sy_dst + buy-leg sy_src), the matured YT (merge yt_src), and the new PT (buy-leg
  // dest + deposit source). The new YT (a `strip` byproduct) is created via the buy-leg setup.
  const setupIxs = await makeSetupIx({
    connection,
    authority: marginfiAccount.authority,
    tokens: [
      { mint: withdrawOpts.withdrawBank.mint, tokenProgram: withdrawOpts.tokenProgram },
      { mint: resolved.syToken.mint, tokenProgram: resolved.syToken.tokenProgram },
      { mint: resolved.mergeAccounts.mintYt, tokenProgram: TOKEN_PROGRAM_ID },
      { mint: depositOpts.depositBank.mint, tokenProgram: depositOpts.tokenProgram },
    ],
  });
  if (resolved.buySetupInstructions.length) {
    setupIxs.push(...resolved.buySetupInstructions);
  }

  const { flashloanTx, withdrawIxs, depositIxs } = await buildRollPtFlashloanTx({
    params,
    resolved,
    blockhash,
  });

  const { instructions: updateFeedIxs, luts: feedLuts } = await makeSmartCrankSwbFeedIx({
    marginfiAccount,
    bankMap,
    oraclePrices,
    assetShareValueMultiplierByBank,
    instructions: [...withdrawIxs.instructions, ...depositIxs.instructions],
    program,
    connection,
    crossbarUrl,
  });

  const additionalTxs: ExtendedV0Transaction[] = [];

  // If ATAs are needed, add them
  if (setupIxs.length > 0) {
    const txs = splitInstructionsToFitTransactions([], setupIxs, {
      blockhash,
      payerKey: marginfiAccount.authority,
      luts: addressLookupTableAccounts ?? [],
    });

    additionalTxs.push(
      ...txs.map((tx) =>
        addTransactionMetadata(tx, {
          type: TransactionType.CREATE_ATA,
          addressLookupTables: addressLookupTableAccounts,
        })
      )
    );
  }

  // If crank is needed, add it
  if (updateFeedIxs.length > 0) {
    const message = new TransactionMessage({
      payerKey: marginfiAccount.authority,
      recentBlockhash: blockhash,
      instructions: updateFeedIxs,
    }).compileToV0Message(feedLuts);

    additionalTxs.push(
      addTransactionMetadata(new VersionedTransaction(message), {
        addressLookupTables: feedLuts,
        type: TransactionType.CRANK,
      })
    );
  }

  const transactions = [...additionalTxs, flashloanTx];

  // Native roll — no external swap quote (kept for interface parity with the other actions).
  return {
    transactions,
    actionTxIndex: transactions.length - 1,
    quoteResponse: undefined,
  };
}

async function buildRollPtFlashloanTx({
  params,
  resolved,
  blockhash,
}: {
  params: MakeRollPtTxParams;
  resolved: ResolvedRoll;
  blockhash: string;
}) {
  const {
    program,
    marginfiAccount,
    bankMap,
    withdrawOpts,
    depositOpts,
    bankMetadataMap,
    addressLookupTableAccounts,
    overrideInferAccounts,
  } = params;
  const {
    actualWithdrawAmount,
    isFullWithdraw,
    mergeAccounts,
    buyInstructions,
    ptOutNative,
    rollLuts,
  } = resolved;
  const { withdrawBank, tokenProgram: withdrawTokenProgram } = withdrawOpts;
  const { depositBank, tokenProgram: depositTokenProgram } = depositOpts;
  const authority = marginfiAccount.authority;

  if (ptOutNative <= 0n) {
    throw new Error("roll-pt: ptOutNative (PT to buy) must be greater than 0");
  }
  if (buyInstructions.length === 0) {
    throw new Error("roll-pt: buy leg (SY → PT_new) must not be empty");
  }

  const cuRequestIxs = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: 1_200_000 }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1 }),
  ];

  // 1. Withdraw the matured PT (plain SPL collateral bank).
  const withdrawIxs: InstructionsWrapper = await makeWithdrawIx({
    program,
    bank: withdrawBank,
    bankMap,
    tokenProgram: withdrawTokenProgram,
    amount: actualWithdrawAmount,
    marginfiAccount,
    authority,
    withdrawAll: isFullWithdraw,
    bankMetadataMap,
    isSync: false,
    opts: { createAtas: false, wrapAndUnwrapSol: false, overrideInferAccounts },
  });

  // 2. Exponent merge: PT_old → SY (1:1, post-maturity, no slippage).
  const mergeIx = makeExponentMergeIx(
    mergeAccounts,
    BigInt(uiToNative(actualWithdrawAmount, withdrawBank.mintDecimals).toString())
  );

  // 3. Buy PT_new with the merged SY (internal strip, or the rollOpts.buy escape hatch).

  // 4. Deposit the new PT. Seeded with a placeholder and byte-patched to the guaranteed
  //    `ptOutNative` (the buy leg's minimum output).
  const depositIxs: InstructionsWrapper = await makeDepositIx({
    program,
    bank: depositBank,
    tokenProgram: depositTokenProgram,
    amount: 0,
    accountAddress: marginfiAccount.address,
    authority,
    group: marginfiAccount.group,
    opts: { wrapAndUnwrapSol: false, overrideInferAccounts },
  });

  const depositIxToPatch = depositIxs.instructions.find(isDepositIx);
  if (!depositIxToPatch) {
    throw new Error("roll-pt: could not locate deposit instruction for amount patching");
  }
  patchDepositAmount(depositIxToPatch, new BN(ptOutNative.toString()));

  // Marginfi group LUTs + the roll's Exponent LUTs (merge ALT, buy ALT, PT-roll LUT).
  const luts = [...(addressLookupTableAccounts ?? []), ...rollLuts];

  const allNonFlIxs = [
    ...cuRequestIxs,
    ...withdrawIxs.instructions,
    mergeIx,
    ...buyInstructions,
    ...depositIxs.instructions,
  ];

  const flashloanTx = await makeFlashLoanTx({
    program,
    marginfiAccount,
    bankMap,
    addressLookupTableAccounts: luts,
    blockhash,
    ixs: allNonFlIxs,
    isSync: false,
  });

  const txSize = getTxSize(flashloanTx);
  const totalKeys = getTotalAccountKeys(flashloanTx);

  if (txSize > MAX_TX_SIZE || totalKeys > MAX_ACCOUNT_LOCKS) {
    throw TransactionBuildingError.swapSizeExceededPositionSwap(txSize, totalKeys);
  }

  return {
    flashloanTx,
    withdrawIxs,
    depositIxs,
  };
}
