import {
  AccountRole,
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
import {
  makeDriftWithdrawIx,
  makeJuplendWithdrawIx,
  makeKaminoWithdrawIx,
  makeWithdrawIx,
} from "./withdraw";

import { MAX_TX_SIZE, MAX_ACCOUNT_LOCKS, TOKEN_2022_PROGRAM_ID, WSOL_MINT } from "~/constants";
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
 * Creates a repay instruction for repaying borrowed assets to a Marginfi bank.
 *
 * This function handles:
 * - Wrapping SOL to wSOL if repaying native SOL
 * - Token-2022 program support with proper remaining accounts
 * - Full or partial repayment of liabilities
 * - Creating the repay instruction to return assets to the bank's liquidity vault
 *
 * @param params - The parameters for creating the repay instruction
 * @param params.programAddress - The marginfi program address
 * @param params.bank - The bank to repay to
 * @param params.tokenProgram - The token program ID (TOKEN_PROGRAM or TOKEN_2022_PROGRAM)
 * @param params.amount - The amount to repay in UI units
 * @param params.authority - The account authority; signs and owns the source token account
 * @param params.accountAddress - The Marginfi account address
 * @param params.group - The Marginfi group address
 * @param params.repayAll - Whether to repay the entire liability (default: false)
 * @param params.opts - Optional configuration
 * @param params.opts.wrapAndUnwrapSol - Whether to wrap SOL to wSOL (default: true)
 * @param params.opts.wSolBalanceUi - Existing wSOL balance to combine with native SOL (default: 0)
 *
 * @returns Promise resolving to the repay instructions
 */
export async function makeRepayIx({
  programAddress,
  bank,
  tokenProgram,
  amount,
  authority,
  accountAddress,
  group,
  repayAll = false,
  opts = {},
}: MakeRepayIxParams): Promise<Instruction[]> {
  const wrapAndUnwrapSol = opts.wrapAndUnwrapSol ?? true;
  const wSolBalanceUi = opts.wSolBalanceUi ?? 0;
  const repayIxs: Instruction[] = [];

  // We allow off curve addresses here to support Fuse.
  const [signerTokenAccount] = await findAssociatedTokenPda({
    mint: bank.mint,
    owner: authority.address,
    tokenProgram,
  });

  if (bank.mint === WSOL_MINT && wrapAndUnwrapSol) {
    repayIxs.push(...(await makeWrapSolIxs(authority, new BigNumber(amount).minus(wSolBalanceUi))));
  }

  repayIxs.push(
    await instructions.makeRepayIx(
      programAddress,
      {
        group,
        marginfiAccount: accountAddress,
        authority,
        bank: bank.address,
        signerTokenAccount,
        liquidityVault: bank.liquidityVault,
        tokenProgram,
        amount: uiToNative(amount, bank.mintDecimals),
        repayAll,
      },
      tokenProgram === TOKEN_2022_PROGRAM_ID
        ? [{ address: bank.mint, role: AccountRole.READONLY }]
        : []
    )
  );

  return repayIxs;
}

/**
 * Creates a complete repay transaction ready to be signed and sent.
 *
 * This function builds a v0 transaction message that includes:
 * - SOL wrapping instructions if repaying native SOL
 * - The actual repay instruction to return assets to the Marginfi bank
 * - Proper support for Token-2022 tokens
 * - Support for full or partial repayment
 *
 * The authority pays the fees and is the only signer.
 *
 * @param params - The parameters for creating the repay transaction
 * @param params.rpc - RPC client, for the blockhash
 * @param params.luts - Address lookup tables for transaction compression
 * @param params.latestBlockhash - Optional recent blockhash (fetched if not provided)
 * @param params.bank - The bank to repay to
 * @param params.amount - The amount to repay in UI units
 * @param params.repayAll - Whether to repay the entire liability (default: false)
 *
 * @returns Promise resolving to the repay transaction
 */
export async function makeRepayTx(params: MakeRepayTxParams): Promise<SolanaTransaction> {
  const { rpc, luts, latestBlockhash, ...repayIxParams } = params;

  const repayIxs = await makeRepayIx(repayIxParams);

  return {
    message: makeTransactionMessage({
      instructions: repayIxs,
      feePayer: params.authority,
      latestBlockhash:
        latestBlockhash ?? (await rpc.getLatestBlockhash({ commitment: "confirmed" }).send()).value,
      // Repays don't add health remaining-accounts, so only the target bank matters.
      luts: selectLutsForBanks(luts, [params.bank]),
    }),
    type: TransactionType.REPAY,
  };
}

export async function makeRepayWithCollatTx(params: MakeRepayWithCollatTxParams) {
  const {
    marginfiAccount,
    authority,
    bankMap,
    withdrawOpts,
    repayOpts,
    bankMetadataMap,
    luts,
    rpc,
  } = params;

  const { value: latestBlockhash } = await rpc
    .getLatestBlockhash({ commitment: "confirmed" })
    .send();

  // Create atas if needed
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
    // filter out compute budget instructions
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

  // if atas are needed, add them
  if (setupIxs.length > 0 || refreshIntegrationIxs.length > 0) {
    const ixs = [...setupIxs, ...refreshIntegrationIxs];
    const messages = splitInstructionsToFitTransactions([], ixs, {
      latestBlockhash,
      feePayer: authority,
      luts: luts ?? {},
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
  const withdrawParams = {
    programAddress,
    bank: withdrawOpts.withdrawBank,
    bankMap,
    tokenProgram: withdrawOpts.tokenProgram,
    amount: withdrawOpts.withdrawAmount,
    marginfiAccount,
    authority,
    withdrawAll,
    opts: {
      createAtas: false,
      wrapAndUnwrapSol: false,
    },
  };

  let withdrawIxs: Instruction[];

  switch (withdrawOpts.withdrawBank.config.assetTag) {
    case AssetTag.KAMINO: {
      const reserve =
        bankMetadataMap[withdrawOpts.withdrawBank.address]?.kaminoStates?.reserveState;

      if (!reserve) {
        throw TransactionBuildingError.kaminoReserveNotFound(
          withdrawOpts.withdrawBank.address,
          withdrawOpts.withdrawBank.mint,
          withdrawOpts.withdrawBank.tokenSymbol
        );
      }

      // Sometimes the ctoken conversion can be off by a few basis points, this accounts for that
      const multiplier =
        assetShareValueMultiplierByBank.get(withdrawOpts.withdrawBank.address) ?? new BigNumber(1);
      const adjustedAmount = new BigNumber(withdrawOpts.withdrawAmount)
        .div(multiplier)
        .times(1.0001)
        .toNumber();

      withdrawIxs = await makeKaminoWithdrawIx({
        ...withdrawParams,
        cTokenAmount: adjustedAmount,
        reserve,
      });
      break;
    }

    case AssetTag.DRIFT: {
      const driftState = bankMetadataMap[withdrawOpts.withdrawBank.address]?.driftStates;

      if (!driftState) {
        throw TransactionBuildingError.driftStateNotFound(
          withdrawOpts.withdrawBank.address,
          withdrawOpts.withdrawBank.mint,
          withdrawOpts.withdrawBank.tokenSymbol
        );
      }

      withdrawIxs = await makeDriftWithdrawIx({
        ...withdrawParams,
        driftSpotMarket: driftState.spotMarketState,
        userRewards: driftState.userRewards,
      });
      break;
    }

    case AssetTag.JUPLEND: {
      const jupLendState = bankMetadataMap[withdrawOpts.withdrawBank.address]?.jupLendStates;

      if (!jupLendState) {
        throw TransactionBuildingError.jupLendStateNotFound(
          withdrawOpts.withdrawBank.address,
          withdrawOpts.withdrawBank.mint,
          withdrawOpts.withdrawBank.tokenSymbol
        );
      }

      withdrawIxs = await makeJuplendWithdrawIx({
        ...withdrawParams,
        jupLendingState: jupLendState.jupLendingState,
      });
      break;
    }

    default: {
      withdrawIxs = await makeWithdrawIx(withdrawParams);
      break;
    }
  }

  const repayParams = {
    programAddress,
    bank: repayOpts.repayBank,
    tokenProgram: repayOpts.tokenProgram,
    accountAddress: marginfiAccount.address,
    authority,
    group: marginfiAccount.group,
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
    latestBlockhash,
    ixs: allNonFlIxs,
  });

  const txSize = getTxSize(flashloanTx.message);
  const totalKeys = getTotalAccountKeys(flashloanTx.message);

  if (txSize > MAX_TX_SIZE || totalKeys > MAX_ACCOUNT_LOCKS) {
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
