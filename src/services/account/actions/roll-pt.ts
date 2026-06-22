import {
  ComputeBudgetProgram,
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
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "~/vendor/spl";
import { makeExponentMergeIx } from "~/vendor/exponent";
import { uiToNative } from "~/utils";

import {
  isWholePosition,
  computeFlashloanSwapConstraints,
  compileFlashloanPrecheck,
  patchDepositAmount,
  isDepositIx,
} from "../utils";
import {
  runSwapEngine,
  swapEngineProvidersFromOpts,
  swapEngineQuoteFieldsFromOpts,
} from "../services/swap-engine";
import { MakeRollPtTxParams, SwapQuoteResult } from "../types";

import { makeSetupIx } from "./account-lifecycle";
import { makeWithdrawIx } from "./withdraw";
import { makeDepositIx } from "./deposit";
import { makeFlashLoanTx } from "./flash-loan";

/**
 * Roll a matured Exponent PT collateral position into its next-maturity PT, in one
 * flash-loan-wrapped bundle:
 *
 *   withdraw PT_old → Exponent `merge` (PT_old → underlying, 1:1, no slippage)
 *     → swap-engine (underlying → PT_new, Titan/Jupiter) → deposit PT_new
 *
 * Splitting the legs this way avoids paying AMM slippage to sell the matured PT — only
 * the buy side (acquiring the new, liquid PT) routes through the swap engine.
 *
 * PT banks are ordinary SPL-collateral banks, so the standard withdraw/deposit builders
 * are used; the only Exponent-specific instruction is `merge`. Mirrors `makeSwapCollateralTx`.
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
    mergeAccounts,
    underlying,
    assetShareValueMultiplierByBank,
    addressLookupTableAccounts,
    crossbarUrl,
  } = params;

  const blockhash = (await connection.getLatestBlockhash("confirmed")).blockhash;

  // ATAs touched across the bundle: old PT (withdraw dest + merge pt_src), the
  // underlying/SY (merge sy_dst + swap input), the YT (merge yt_src; empty after
  // maturity), and the new PT (swap dest + deposit source).
  const setupIxs = await makeSetupIx({
    connection,
    authority: marginfiAccount.authority,
    tokens: [
      { mint: withdrawOpts.withdrawBank.mint, tokenProgram: withdrawOpts.tokenProgram },
      { mint: underlying.mint, tokenProgram: underlying.tokenProgram ?? TOKEN_PROGRAM_ID },
      { mint: mergeAccounts.mintYt, tokenProgram: TOKEN_PROGRAM_ID },
      { mint: depositOpts.depositBank.mint, tokenProgram: depositOpts.tokenProgram },
    ],
  });

  const { flashloanTx, setupInstructions, swapQuote, withdrawIxs, depositIxs } =
    await buildRollPtFlashloanTx({
      ...params,
      blockhash,
    });

  // Filter engine-provided swap setup instructions to avoid duplicates with our setup.
  const engineSetupInstructions = setupInstructions.filter((ix) => {
    if (ix.programId.equals(ComputeBudgetProgram.programId)) return false;
    if (ix.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID)) {
      const mintKey = ix.keys[3]?.pubkey;
      if (
        mintKey?.equals(withdrawOpts.withdrawBank.mint) ||
        mintKey?.equals(underlying.mint) ||
        mintKey?.equals(mergeAccounts.mintYt) ||
        mintKey?.equals(depositOpts.depositBank.mint)
      ) {
        return false;
      }
    }
    return true;
  });

  setupIxs.push(...engineSetupInstructions);

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

  return {
    transactions,
    actionTxIndex: transactions.length - 1,
    quoteResponse: swapQuote,
  };
}

async function buildRollPtFlashloanTx({
  program,
  marginfiAccount,
  bankMap,
  withdrawOpts,
  depositOpts,
  mergeAccounts,
  underlying,
  redeemedAmountNative,
  swapOpts,
  bankMetadataMap,
  addressLookupTableAccounts,
  connection,
  overrideInferAccounts,
  blockhash,
  swapEngineRunner,
}: MakeRollPtTxParams & { blockhash: string }) {
  const { withdrawBank, tokenProgram: withdrawTokenProgram, totalPositionAmount } = withdrawOpts;
  const { depositBank, tokenProgram: depositTokenProgram } = depositOpts;
  const authority = marginfiAccount.authority;

  // Validate and clamp withdrawAmount
  if (withdrawOpts.withdrawAmount !== undefined && withdrawOpts.withdrawAmount <= 0) {
    throw new Error("withdrawAmount must be greater than 0");
  }
  const actualWithdrawAmount = Math.min(
    withdrawOpts.withdrawAmount ?? totalPositionAmount,
    totalPositionAmount
  );
  const isFullWithdraw = isWholePosition(
    { amount: totalPositionAmount, isLending: true },
    actualWithdrawAmount,
    withdrawBank.mintDecimals
  );

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

  // 2. Exponent merge: PT_old → underlying (1:1, post-maturity, no slippage).
  const mergeIx = makeExponentMergeIx(
    mergeAccounts,
    BigInt(uiToNative(actualWithdrawAmount, withdrawBank.mintDecimals).toString())
  );

  // 4. Deposit the new PT. Seeded with a placeholder amount and byte-patched to the real
  //    swap output after the engine runs (the deposit footprint is amount-independent).
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

  // 3. Swap the redeemed underlying into the new PT via the engine (Titan/Jupiter).
  const destinationTokenAccount = getAssociatedTokenAddressSync(
    depositBank.mint,
    authority,
    true,
    depositTokenProgram.equals(TOKEN_2022_PROGRAM_ID) ? TOKEN_2022_PROGRAM_ID : undefined
  );

  const swapConstraints = await computeFlashloanSwapConstraints({
    program,
    marginfiAccount,
    bankMap,
    bankMetadataMap,
    addressLookupTableAccounts: addressLookupTableAccounts ?? [],
    primaryIx: { type: "withdraw", bank: withdrawBank, tokenProgram: withdrawTokenProgram },
    secondaryIx: { type: "deposit", bank: depositBank, tokenProgram: depositTokenProgram },
    overrideInferAccounts,
  });

  const runEngine = swapEngineRunner ?? runSwapEngine;
  const engineResult = await runEngine({
    inputMint: underlying.mint.toBase58(),
    outputMint: depositBank.mint.toBase58(),
    amountNative: Number(redeemedAmountNative),
    inputDecimals: underlying.decimals,
    outputDecimals: depositBank.mintDecimals,
    ...swapEngineQuoteFieldsFromOpts(swapOpts),
    taker: authority,
    destinationTokenAccount,
    connection,
    footprint: {
      instructions: [
        ...cuRequestIxs,
        ...withdrawIxs.instructions,
        mergeIx,
        ...depositIxs.instructions,
      ],
      luts: addressLookupTableAccounts ?? [],
      payer: authority,
      sizeConstraint: swapConstraints.sizeConstraint,
      maxSwapTotalAccounts: swapConstraints.maxSwapTotalAccounts,
    },
    providers: swapEngineProvidersFromOpts(swapOpts),
  });

  // Patch the seeded deposit to the real (minimum guaranteed) swap output.
  const depositIxToPatch = depositIxs.instructions.find(isDepositIx);
  if (!depositIxToPatch) {
    throw new Error("roll-pt: could not locate deposit instruction for amount patching");
  }
  patchDepositAmount(depositIxToPatch, engineResult.outputAmountNative);

  const swapInstructions = engineResult.swapInstructions;
  const setupInstructions = engineResult.setupInstructions;
  const swapLookupTables = engineResult.swapLuts;
  const swapQuote = engineResult.quoteResponse;

  const luts = [...(addressLookupTableAccounts ?? []), ...swapLookupTables];

  const allNonFlIxs = [
    ...cuRequestIxs,
    ...withdrawIxs.instructions,
    mergeIx,
    ...swapInstructions,
    ...depositIxs.instructions,
  ];

  if (swapInstructions.length > 0) {
    compileFlashloanPrecheck({
      allIxs: allNonFlIxs,
      payer: authority,
      luts,
      sizeConstraint: swapConstraints.sizeConstraint,
      swapIxCount: swapInstructions.length,
      swapLutCount: swapLookupTables.length,
    });
  }

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
    throw TransactionBuildingError.swapSizeExceededPositionSwap(
      txSize,
      totalKeys,
      swapOpts.swapConfig?.provider
    );
  }

  return {
    flashloanTx,
    setupInstructions,
    swapQuote,
    withdrawIxs,
    depositIxs,
  };
}
