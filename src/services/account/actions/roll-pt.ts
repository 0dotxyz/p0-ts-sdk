import {
  AddressLookupTableAccount,
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
  getAssociatedTokenAddressSync,
} from "~/vendor/spl";
import {
  ExponentWrapperMergeContext,
  makeExponentWrapperMergeIx,
  resolveExponentWrapperMergeContext,
} from "~/vendor/exponent";
import { uiToNative } from "~/utils";

import {
  isWholePosition,
  computeFlashLoanNonSwapBudget,
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
 * Roll a matured Exponent PT collateral position into its next-maturity PT, so the **full
 * deposit ends up as new PT** (no leftover), in one flash-loan-wrapped bundle:
 *
 *   withdraw PT_old → Exponent `wrapper_merge` (PT_old → underlying base, e.g. bulkSOL)
 *     → swap-engine (base → PT_new, Titan/Jupiter) → deposit PT_new
 *
 * Structurally `makeSwapCollateralTx` with a `wrapper_merge` leg in front: the matured PT is
 * redeemed to a normal, swappable base token (never the un-swappable SY), then the existing
 * multi-provider swap engine buys the new PT. The caller passes the matured Exponent
 * market/vault + base token (`rollOpts`) and the swap config (`swapOpts`); everything Exponent
 * is resolved internally. The buy is bounded by the new PT's market depth.
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
    rollOpts,
    assetShareValueMultiplierByBank,
    addressLookupTableAccounts,
    crossbarUrl,
  } = params;

  if (!rollOpts.maturedMarket && !rollOpts.maturedVault) {
    throw new Error("roll-pt: rollOpts.maturedMarket or maturedVault is required");
  }

  // Resolve the matured vault's `wrapper_merge` (redeem PT → base) accounts up front.
  const wrapper = await resolveExponentWrapperMergeContext({
    connection,
    owner: marginfiAccount.authority,
    market: rollOpts.maturedMarket,
    vault: rollOpts.maturedVault,
    baseMint: rollOpts.baseMint,
    baseTokenProgram: rollOpts.baseTokenProgram,
    ptYtTokenProgram: withdrawOpts.tokenProgram,
  });

  const blockhash = (await connection.getLatestBlockhash("confirmed")).blockhash;

  // ATAs the bundle touches: old PT (withdraw dest + wrapper pt_src), the wrapper's
  // intermediates (base, SY, YT), and the new PT (swap dest + deposit source).
  const setupIxs = await makeSetupIx({
    connection,
    authority: marginfiAccount.authority,
    tokens: [
      { mint: withdrawOpts.withdrawBank.mint, tokenProgram: withdrawOpts.tokenProgram },
      ...wrapper.setupMints,
      { mint: depositOpts.depositBank.mint, tokenProgram: depositOpts.tokenProgram },
    ],
  });
  // The flavor's pre-instructions (e.g. the SPL stake-pool balance refresh) only need to run
  // *before* `wrapper_merge`, not atomically with it — so they go in the setup tx (chained
  // state), keeping their accounts out of the size/lock-constrained flashloan.
  setupIxs.push(...wrapper.preInstructions);

  const { flashloanTx, setupInstructions, swapQuote, withdrawIxs, depositIxs } =
    await buildRollPtFlashloanTx({ params, wrapper, blockhash });

  // Filter swap-engine setup ixs to avoid duplicating our own ATA creates / CU ixs.
  const swapSetupInstructions = setupInstructions.filter((ix) => {
    if (ix.programId.equals(ComputeBudgetProgram.programId)) return false;
    if (ix.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID)) {
      const mintKey = ix.keys[3]?.pubkey;
      if (mintKey?.equals(withdrawOpts.withdrawBank.mint) || mintKey?.equals(depositOpts.depositBank.mint)) {
        return false;
      }
    }
    return true;
  });
  setupIxs.push(...swapSetupInstructions);

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
  params,
  wrapper,
  blockhash,
}: {
  params: MakeRollPtTxParams;
  wrapper: ExponentWrapperMergeContext;
  blockhash: string;
}) {
  const {
    program,
    marginfiAccount,
    bankMap,
    withdrawOpts,
    depositOpts,
    swapOpts,
    bankMetadataMap,
    connection,
    addressLookupTableAccounts,
    overrideInferAccounts,
    rollOpts,
    swapEngineRunner,
  } = params;
  const { withdrawBank, tokenProgram: withdrawTokenProgram, totalPositionAmount, withdrawAmount } =
    withdrawOpts;
  const { depositBank, tokenProgram: depositTokenProgram } = depositOpts;
  const authority = marginfiAccount.authority;

  if (withdrawAmount !== undefined && withdrawAmount <= 0) {
    throw new Error("withdrawAmount must be greater than 0");
  }
  const actualWithdrawAmount = Math.min(withdrawAmount ?? totalPositionAmount, totalPositionAmount);
  const isFullWithdraw = isWholePosition(
    { amount: totalPositionAmount, isLending: true },
    actualWithdrawAmount,
    withdrawBank.mintDecimals
  );
  const withdrawNative = BigInt(
    uiToNative(actualWithdrawAmount, withdrawBank.mintDecimals).toString()
  );

  const cuRequestIxs = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: 1_200_000 }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1 }),
  ];

  // 1. Withdraw the matured PT (standard SPL collateral bank).
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

  // 2. `wrapper_merge`: PT_old → base, post-maturity. The flavor's pre-instructions (stake-pool
  //    refresh) run in the setup tx (see makeRollPtTx), not here, to keep them out of the
  //    account-constrained flashloan.
  const wrapperMergeIx = makeExponentWrapperMergeIx(wrapper.wrapperMergeAccounts, {
    amountPyNative: withdrawNative,
    redeemSyAccountsUntil: wrapper.wrapperMergeAccounts.redeemSyAccountsUntil,
  });
  const redeemIxs = [wrapperMergeIx];

  // 3. Deposit the new PT — seeded with a placeholder, byte-patched to the swap's min output.
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

  // LUTs for the non-swap footprint. `wrapper_merge` is account-heavy, so the swap engine sizes
  // its route against this; over the WebSocket template the budget is generous, but the template
  // is cleanest with a *single* dedicated PT-roll LUT that covers the whole non-swap footprint
  // (marginfi banks + the wrapper_merge accounts) — see `create-pt-roll-lut.ts`. Falls back to
  // the marginfi group LUTs + the vault ALT when no dedicated LUT is supplied.
  let baseLuts: AddressLookupTableAccount[];
  if (rollOpts.lookupTable) {
    const fetched = (await connection.getAddressLookupTable(rollOpts.lookupTable)).value;
    if (!fetched) {
      throw new Error(`roll-pt: PT-roll lookup table not found: ${rollOpts.lookupTable.toBase58()}`);
    }
    baseLuts = [fetched];
  } else {
    baseLuts = [...(addressLookupTableAccounts ?? []), wrapper.addressLookupTable];
  }

  // Size the swap around the *full* non-swap footprint (incl. the heavy `wrapper_merge`).
  const nonSwapFootprint = [
    ...cuRequestIxs,
    ...withdrawIxs.instructions,
    ...redeemIxs,
    ...depositIxs.instructions,
  ];
  const { sizeConstraint, maxSwapTotalAccounts } = computeFlashLoanNonSwapBudget({
    program,
    marginfiAccount,
    bankMap,
    addressLookupTableAccounts: baseLuts,
    ixs: nonSwapFootprint,
  });

  // 4. Buy the new PT with the redeemed base. The base is the swap input; for an appreciating
  //    LST the on-chain redeem yields ≥ this estimate, so it's a safe (never-short) lower bound.
  const destinationTokenAccount = getAssociatedTokenAddressSync(
    depositBank.mint,
    authority,
    true,
    depositTokenProgram.equals(TOKEN_2022_PROGRAM_ID) ? TOKEN_2022_PROGRAM_ID : undefined
  );
  const baseAmountNative = wrapper.computeRedeemedBaseNative(withdrawNative);

  const runEngine = swapEngineRunner ?? runSwapEngine;
  const engineResult = await runEngine({
    inputMint: wrapper.baseToken.mint.toBase58(),
    outputMint: depositBank.mint.toBase58(),
    amountNative: Number(baseAmountNative),
    inputDecimals: wrapper.baseToken.decimals,
    outputDecimals: depositBank.mintDecimals,
    ...swapEngineQuoteFieldsFromOpts(swapOpts),
    taker: authority,
    destinationTokenAccount,
    connection,
    footprint: {
      instructions: nonSwapFootprint,
      luts: baseLuts,
      payer: authority,
      sizeConstraint,
      maxSwapTotalAccounts,
    },
    providers: swapEngineProvidersFromOpts(swapOpts),
  });

  // Patch the seeded deposit to the real (minimum guaranteed) swap output.
  const depositIxToPatch = depositIxs.instructions.find(isDepositIx);
  if (!depositIxToPatch) {
    throw new Error("roll-pt: could not locate deposit instruction for amount patching");
  }
  patchDepositAmount(depositIxToPatch, engineResult.outputAmountNative);

  const luts = [...baseLuts, ...engineResult.swapLuts];

  const allNonFlIxs = [
    ...cuRequestIxs,
    ...withdrawIxs.instructions,
    ...redeemIxs,
    ...engineResult.swapInstructions,
    ...depositIxs.instructions,
  ];

  compileFlashloanPrecheck({
    allIxs: allNonFlIxs,
    payer: authority,
    luts,
    sizeConstraint,
    swapIxCount: engineResult.swapInstructions.length,
    swapLutCount: engineResult.swapLuts.length,
  });

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
    setupInstructions: engineResult.setupInstructions,
    swapQuote: engineResult.quoteResponse,
    withdrawIxs,
    depositIxs,
  };
}
