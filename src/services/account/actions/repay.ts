import {
  getTransactionMessageSizeLimit,
  type AddressesByLookupTableAddress,
  type BlockhashLifetimeConstraint,
  type Instruction,
} from "@solana/kit";
import {
  COMPUTE_BUDGET_PROGRAM_ADDRESS,
  getSetComputeUnitLimitInstruction,
  getSetComputeUnitPriceInstruction,
} from "@solana-program/compute-budget";
import { ASSOCIATED_TOKEN_PROGRAM_ADDRESS, findAssociatedTokenPda } from "@solana-program/token";
import { BigNumber } from "bignumber.js";

import {
  runSwapEngine,
  swapEngineProvidersFromOpts,
  swapEngineQuoteFieldsFromOpts,
} from "../services/swap-engine";
import {
  MakeRepayIxParams,
  MakeRepayTxParams,
  MakeRepayWithCollatTxParams,
  SwapQuoteResult,
} from "../types";
import {
  isWholePosition,
  computeFlashloanSwapConstraints,
  compileFlashloanPrecheck,
} from "../utils";

import { makeSetupIx } from "./account-lifecycle";
import { makeFlashLoanTx } from "./flash-loan";
import { makeWithdrawIx } from "./withdraw";

import { MAX_ACCOUNT_LOCKS, WSOL_MINT } from "~/constants";
import { TransactionBuildingError } from "~/errors";
import instructions from "~/instructions";
import { AssetTag } from "~/services/bank";
import { makeRefreshIntegrationBanksIxs } from "~/services/price";
import {
  getTotalAccountKeys,
  getTxSize,
  makeTransactionMessage,
  makeWrapSolIxs,
  selectLutsForBanks,
  SolanaTransaction,
  splitInstructionsToFitTransactions,
  TransactionType,
} from "~/services/transaction";
import { nativeToUi, uiToNative } from "~/utils";

/**
 * Repays `amount` (UI units of the bank's mint) of `bank`'s liability; `repayAll` closes the
 * balance. A wSOL repay first wraps native SOL, net of `opts.wSolBalanceUi`, unless
 * `opts.wrapAndUnwrapSol` is false.
 */
export async function makeRepayIx({
  programAddress,
  bank,
  tokenProgram,
  amount,
  marginfiAccount,
  authority,
  repayAll = false,
  opts = {},
}: MakeRepayIxParams): Promise<Instruction[]> {
  const repayIxs: Instruction[] = [];

  if (bank.mint === WSOL_MINT && (opts.wrapAndUnwrapSol ?? true)) {
    repayIxs.push(
      ...(await makeWrapSolIxs(authority, new BigNumber(amount).minus(opts.wSolBalanceUi ?? 0)))
    );
  }

  const [signerTokenAccount] = await findAssociatedTokenPda({
    mint: bank.mint,
    owner: authority.address,
    tokenProgram,
  });

  repayIxs.push(
    await instructions.makeRepayIx(programAddress, {
      group: marginfiAccount.group,
      marginfiAccount: marginfiAccount.address,
      authority,
      bank: bank.address,
      signerTokenAccount,
      liquidityVault: bank.liquidityVault,
      mint: bank.mint,
      tokenProgram,
      amount: uiToNative(amount, bank.mintDecimals),
      repayAll,
    })
  );

  return repayIxs;
}

/**
 * Builds a repay transaction around {@link makeRepayIx}. The authority pays and signs;
 * `latestBlockhash` is fetched when omitted.
 */
export async function makeRepayTx(params: MakeRepayTxParams): Promise<SolanaTransaction> {
  const { rpc, luts, latestBlockhash, version, ...repayIxParams } = params;

  const repayIxs = await makeRepayIx(repayIxParams);

  return {
    message: makeTransactionMessage({
      instructions: repayIxs,
      feePayer: params.authority,
      latestBlockhash:
        latestBlockhash ?? (await rpc.getLatestBlockhash({ commitment: "confirmed" }).send()).value,
      // Repays don't add health remaining-accounts, so only the target bank matters.
      luts: selectLutsForBanks(luts, [params.bank]),
      version,
    }),
    type: TransactionType.REPAY,
  };
}

/**
 * Repays `repayOpts.repayBank`'s liability with collateral in one flash loan: withdraws
 * `withdrawOpts.withdrawAmount` (UI units) from `withdrawOpts.withdrawBank`, swaps it into the
 * repay mint when the mints differ, and repays the swap's minimum output (the withdrawn amount
 * when no swap is needed), or the whole liability when the quoted output covers
 * `repayOpts.totalPositionAmount`. ATA creation and integration-bank refreshes go in
 * transactions before the flash loan, which must land in the same bundle when
 * `mustBeAtomicBundle` is set.
 * @throws TransactionBuildingError if the swap has no route, the flash loan transaction exceeds
 * the size or account-lock limits, or the withdraw bank's venue state is missing
 */
export async function makeRepayWithCollatTx(params: MakeRepayWithCollatTxParams) {
  const {
    marginfiAccount,
    authority,
    bankMap,
    withdrawOpts,
    repayOpts,
    bankMetadataMap,
    luts,
    version,
    rpc,
  } = params;

  const { value: latestBlockhash } = await rpc
    .getLatestBlockhash({ commitment: "confirmed" })
    .send();

  const setupIxs = await makeSetupIx({
    rpc,
    authority,
    tokens: [
      {
        mint: repayOpts.repayBank.mint,
        tokenProgram: repayOpts.tokenProgram,
      },
      {
        mint: withdrawOpts.withdrawBank.mint,
        tokenProgram: withdrawOpts.tokenProgram,
      },
    ],
  });

  const refreshIntegrationIxs = await makeRefreshIntegrationBanksIxs(
    marginfiAccount,
    bankMap,
    [withdrawOpts.withdrawBank.address],
    bankMetadataMap,
    [withdrawOpts.withdrawBank.address, repayOpts.repayBank.address]
  );

  const { flashloanTx, setupInstructions, swapQuote, amountToRepay } =
    await buildRepayWithCollatFlashloanTx({
      ...params,
      latestBlockhash,
    });

  const jupiterSetupInstructions = setupInstructions.filter((ix) => {
    if (ix.programAddress === COMPUTE_BUDGET_PROGRAM_ADDRESS) {
      return false;
    }

    if (ix.programAddress === ASSOCIATED_TOKEN_PROGRAM_ADDRESS) {
      // key 3 is always mint in create ata
      const mintKey = ix.accounts?.[3]?.address;

      if (mintKey === withdrawOpts.withdrawBank.mint || mintKey === repayOpts.repayBank.mint) {
        return false;
      }
    }

    return true;
  });

  setupIxs.push(...jupiterSetupInstructions);

  const additionalTxs: SolanaTransaction[] = [];

  if (setupIxs.length > 0 || refreshIntegrationIxs.length > 0) {
    const ixs = [...setupIxs, ...refreshIntegrationIxs];
    const messages = splitInstructionsToFitTransactions([], ixs, {
      latestBlockhash,
      feePayer: authority,
      luts: luts ?? {},
      version,
    });

    additionalTxs.push(
      ...messages.map((message) => ({ message, type: TransactionType.CREATE_ATA }))
    );
  }

  const transactions = [...additionalTxs, flashloanTx];
  return {
    transactions,
    swapQuote,
    amountToRepay,
    mustBeAtomicBundle: refreshIntegrationIxs.length > 0,
  };
}

async function buildRepayWithCollatFlashloanTx({
  programAddress,
  marginfiAccount,
  authority,
  bankMap,
  withdrawOpts,
  repayOpts,
  bankMetadataMap,
  assetShareValueMultiplierByBank,
  luts,
  version,
  rpc,
  swapOpts,
  latestBlockhash,
  swapEngineRunner,
}: MakeRepayWithCollatTxParams & { latestBlockhash: BlockhashLifetimeConstraint }) {
  const cuRequestIxs = [
    getSetComputeUnitLimitInstruction({ units: 1_200_000 }),
    getSetComputeUnitPriceInstruction({ microLamports: 1 }),
  ];

  // Deferred-swap: when a swap is needed, withdraw token A is swapped (ExactIn) into
  // the repay token; the repay amount comes from the swap output. The input here is
  // the known withdraw amount, so no ExactOut estimate is needed. The engine call is
  // deferred until after the withdraw ixs exist (they form part of the footprint).
  const swapNeeded = repayOpts.repayBank.mint !== withdrawOpts.withdrawBank.mint;
  let amountToRepay = swapNeeded ? 0 : withdrawOpts.withdrawAmount;
  let swapInstructions: Instruction[] = [];
  let setupInstructions: Instruction[] = [];
  let swapLookupTables: AddressesByLookupTableAddress = {};
  let swapQuote: SwapQuoteResult | undefined;
  let sizeConstraintUsed = 0;

  const withdrawAll = isWholePosition(
    {
      amount: withdrawOpts.totalPositionAmount,
      isLending: true,
    },
    withdrawOpts.withdrawAmount,
    withdrawOpts.withdrawBank.mintDecimals
  );
  // Kamino withdraws are sized in cTokens; the conversion can be off by a few basis points, so pad
  // it to be sure the withdraw covers the swap input.
  const kaminoMultiplier =
    assetShareValueMultiplierByBank.get(withdrawOpts.withdrawBank.address) ?? new BigNumber(1);
  const withdrawIxs = await makeWithdrawIx({
    programAddress,
    bank: withdrawOpts.withdrawBank,
    bankMap,
    tokenProgram: withdrawOpts.tokenProgram,
    amount:
      withdrawOpts.withdrawBank.config.assetTag === AssetTag.KAMINO
        ? {
            value: new BigNumber(withdrawOpts.withdrawAmount)
              .div(kaminoMultiplier)
              .times(1.0001)
              .toNumber(),
            type: "cToken",
          }
        : withdrawOpts.withdrawAmount,
    marginfiAccount,
    authority,
    bankMetadataMap,
    withdrawAll,
    opts: {
      createAtas: false,
      wrapAndUnwrapSol: false,
    },
  });

  const repayParams = {
    programAddress,
    bank: repayOpts.repayBank,
    tokenProgram: repayOpts.tokenProgram,
    marginfiAccount,
    authority,
    opts: { wrapAndUnwrapSol: false },
  };

  if (swapNeeded) {
    const [destinationTokenAccount] = await findAssociatedTokenPda({
      mint: repayOpts.repayBank.mint,
      owner: authority.address,
      tokenProgram: repayOpts.tokenProgram,
    });

    const swapConstraints = await computeFlashloanSwapConstraints({
      programAddress,
      marginfiAccount,
      bankMap,
      bankMetadataMap,
      luts: luts ?? {},
      primaryIx: {
        type: "withdraw",
        bank: withdrawOpts.withdrawBank,
        tokenProgram: withdrawOpts.tokenProgram,
      },
      secondaryIx: {
        type: "repay",
        bank: repayOpts.repayBank,
        tokenProgram: repayOpts.tokenProgram,
      },
    });
    sizeConstraintUsed = swapConstraints.sizeConstraint;

    // Placeholder repay ix for the engine footprint (its size is amount-independent);
    // the real repay ix below uses the swap-derived amountToRepay.
    const footprintRepayIxs = await makeRepayIx({
      ...repayParams,
      amount: withdrawOpts.withdrawAmount,
    });

    const runEngine = swapEngineRunner ?? runSwapEngine;
    const engineResult = await runEngine({
      inputMint: withdrawOpts.withdrawBank.mint,
      outputMint: repayOpts.repayBank.mint,
      amountNative: Number(
        uiToNative(withdrawOpts.withdrawAmount, withdrawOpts.withdrawBank.mintDecimals)
      ),
      inputDecimals: withdrawOpts.withdrawBank.mintDecimals,
      outputDecimals: repayOpts.repayBank.mintDecimals,
      ...swapEngineQuoteFieldsFromOpts(swapOpts),
      taker: authority.address,
      destinationTokenAccount,
      rpc,
      footprint: {
        instructions: [...cuRequestIxs, ...withdrawIxs, ...footprintRepayIxs],
        luts: luts ?? {},
        version,
        payer: authority.address,
        sizeConstraint: swapConstraints.sizeConstraint,
        maxSwapTotalAccounts: swapConstraints.maxSwapTotalAccounts,
      },
      providers: swapEngineProvidersFromOpts(swapOpts),
    });

    const outAmount = nativeToUi(
      engineResult.quoteResponse.outAmount,
      repayOpts.repayBank.mintDecimals
    );
    const outAmountThreshold = nativeToUi(
      engineResult.quoteResponse.otherAmountThreshold,
      repayOpts.repayBank.mintDecimals
    );
    amountToRepay =
      outAmount > repayOpts.totalPositionAmount
        ? repayOpts.totalPositionAmount
        : outAmountThreshold;
    swapInstructions = engineResult.swapInstructions;
    setupInstructions = engineResult.setupInstructions;
    swapLookupTables = engineResult.swapLuts;
    swapQuote = engineResult.quoteResponse;
  }

  const repayIxs = await makeRepayIx({
    ...repayParams,
    amount: amountToRepay,
    repayAll: isWholePosition(
      {
        amount: repayOpts.totalPositionAmount,
        isLending: true,
      },
      amountToRepay,
      repayOpts.repayBank.mintDecimals
    ),
  });

  const flashloanLuts = { ...luts, ...swapLookupTables };

  const allNonFlIxs = [...cuRequestIxs, ...withdrawIxs, ...swapInstructions, ...repayIxs];

  if (swapInstructions.length > 0) {
    compileFlashloanPrecheck({
      allIxs: allNonFlIxs,
      payer: authority.address,
      luts: flashloanLuts,
      sizeConstraint: sizeConstraintUsed,
      swapIxCount: swapInstructions.length,
      swapLutCount: Object.keys(swapLookupTables).length,
      version,
    });
  }

  // if cuRequestIxs are not present, priority fee ix is needed
  // wallets add a priority fee ix by default breaking the flashloan tx so we need to add a placeholder priority fee ix
  // docs: https://docs.phantom.app/developer-powertools/solana-priority-fees
  // Solflare requires you to also include the set compute unit price to avoid transaction rejection on flashloans.
  const flashloanTx = await makeFlashLoanTx({
    programAddress,
    marginfiAccount,
    authority,
    bankMap,
    luts: flashloanLuts,
    version,
    latestBlockhash,
    ixs: allNonFlIxs,
  });

  const txSize = getTxSize(flashloanTx.message);
  const totalKeys = getTotalAccountKeys(flashloanTx.message);

  if (
    txSize > getTransactionMessageSizeLimit(flashloanTx.message) ||
    totalKeys > MAX_ACCOUNT_LOCKS
  ) {
    throw TransactionBuildingError.swapSizeExceededRepay(
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
    repayIxs,
    amountToRepay,
  };
}
