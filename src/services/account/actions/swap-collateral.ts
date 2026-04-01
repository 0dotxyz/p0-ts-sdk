import { BigNumber } from "bignumber.js";
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
  getWritableAccountKeys,
  getTxSize,
  getTotalAccountKeys,
  InstructionsWrapper,
  splitInstructionsToFitTransactions,
  TransactionType,
} from "~/services/transaction";
import {
  makeRefreshKaminoBanksIxs,
  makeSmartCrankSwbFeedIx,
  makeUpdateDriftMarketIxs,
  makeUpdateJupLendRateIxs,
} from "~/services/price";
import { AssetTag } from "~/services/bank";
import { TransactionBuildingError } from "~/errors";
import { MAX_TX_SIZE, MAX_WRITABLE_ACCOUNTS, MAX_ACCOUNT_LOCKS } from "~/constants";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "~/vendor/spl";
import { nativeToUi, uiToNative } from "~/utils";

import {
  getSwapIxsForFlashloan,
  isWholePosition,
  computeFlashloanSwapConstraints,
  compileFlashloanPrecheck,
} from "../utils";
import { MakeSwapCollateralTxParams, SwapProvider, SwapQuoteResult } from "../types";

import { makeSetupIx } from "./account-lifecycle";
import {
  makeDriftWithdrawIx,
  makeJuplendWithdrawIx,
  makeKaminoWithdrawIx,
  makeWithdrawIx,
} from "./withdraw";
import {
  makeDepositIx,
  makeDriftDepositIx,
  makeJuplendDepositIx,
  makeKaminoDepositIx,
} from "./deposit";
import { makeFlashLoanTx } from "./flash-loan";

/**
 * Creates transactions to swap one collateral position to another using a flash loan.
 *
 * This allows users to change their collateral type (e.g., JitoSOL -> mSOL) without
 * withdrawing and affecting their health during the swap.
 *
 * @example
 * const { transactions, actionTxIndex, quoteResponse } = await makeSwapCollateralTx({
 *   program,
 *   marginfiAccount,
 *   connection,
 *   bankMap,
 *   oraclePrices,
 *   withdrawOpts: { totalPositionAmount: 10, withdrawBank: jitoSolBank, tokenProgram },
 *   depositOpts: { depositBank: mSolBank, tokenProgram },
 *   swapOpts: { swapConfig: { provider: SwapProvider.JUPITER, slippageMode: "DYNAMIC", slippageBps: 50, platformFeeBps: 0 } },
 *   // ...
 * });
 */
export async function makeSwapCollateralTx(params: MakeSwapCollateralTxParams): Promise<{
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
    bankMetadataMap,
    assetShareValueMultiplierByBank,
    addressLookupTableAccounts,
    crossbarUrl,
    additionalIxs = [],
  } = params;

  const blockhash = (await connection.getLatestBlockhash("confirmed")).blockhash;

  const setupIxs = await makeSetupIx({
    connection,
    authority: marginfiAccount.authority,
    tokens: [
      { mint: withdrawOpts.withdrawBank.mint, tokenProgram: withdrawOpts.tokenProgram },
      { mint: depositOpts.depositBank.mint, tokenProgram: depositOpts.tokenProgram },
    ],
  });

  const updateJupLendRateIxs = makeUpdateJupLendRateIxs(
    params.marginfiAccount,
    params.bankMap,
    [depositOpts.depositBank.address],
    params.bankMetadataMap
  );

  const updateDriftMarketIxs = makeUpdateDriftMarketIxs(
    marginfiAccount,
    bankMap,
    [withdrawOpts.withdrawBank.address],
    bankMetadataMap
  );

  // Build Kamino refresh instructions (returns empty if no Kamino banks involved)
  const kaminoRefreshIxs = makeRefreshKaminoBanksIxs(
    marginfiAccount,
    bankMap,
    [withdrawOpts.withdrawBank.address, depositOpts.depositBank.address],
    bankMetadataMap
  );

  const { flashloanTx, setupInstructions, swapQuote, withdrawIxs, depositIxs } =
    await buildSwapCollateralFlashloanTx({
      ...params,
      blockhash,
    });

  // Filter Jupiter setup instructions to avoid duplicates with our setup
  const jupiterSetupInstructions = setupInstructions.filter((ix) => {
    // Filter out compute budget instructions
    if (ix.programId.equals(ComputeBudgetProgram.programId)) {
      return false;
    }

    if (ix.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID)) {
      // Key 3 is always mint in create ATA instruction
      const mintKey = ix.keys[3]?.pubkey;

      if (
        mintKey?.equals(withdrawOpts.withdrawBank.mint) ||
        mintKey?.equals(depositOpts.depositBank.mint)
      ) {
        return false;
      }
    }

    return true;
  });

  setupIxs.push(...jupiterSetupInstructions);

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

  let additionalTxs: ExtendedV0Transaction[] = [];

  // If ATAs, additional instructions, or refreshes are needed, add them
  if (
    setupIxs.length > 0 ||
    kaminoRefreshIxs.instructions.length > 0 ||
    updateDriftMarketIxs.instructions.length > 0 ||
    updateJupLendRateIxs.instructions.length > 0
  ) {
    const ixs = [
      ...setupIxs,
      ...kaminoRefreshIxs.instructions,
      ...updateDriftMarketIxs.instructions,
      ...updateJupLendRateIxs.instructions,
    ];
    const txs = splitInstructionsToFitTransactions([], ixs, {
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

async function buildSwapCollateralFlashloanTx({
  program,
  marginfiAccount,
  bankMap,
  withdrawOpts,
  depositOpts,
  swapOpts,
  bankMetadataMap,
  assetShareValueMultiplierByBank,
  addressLookupTableAccounts,
  connection,
  overrideInferAccounts,
  blockhash,
}: MakeSwapCollateralTxParams & { blockhash: string }) {
  const {
    withdrawBank,
    tokenProgram: withdrawTokenProgram,
    totalPositionAmount,
    withdrawAmount,
  } = withdrawOpts;
  const { depositBank, tokenProgram: depositTokenProgram } = depositOpts;

  // Validate and clamp withdrawAmount
  if (withdrawAmount !== undefined && withdrawAmount <= 0) {
    throw new Error("withdrawAmount must be greater than 0");
  }

  // Use withdrawAmount if provided, otherwise use totalPositionAmount (full swap)
  // Clamp to totalPositionAmount to prevent withdrawing more than exists
  const actualWithdrawAmount = Math.min(withdrawAmount ?? totalPositionAmount, totalPositionAmount);
  const isFullWithdraw = isWholePosition(
    { amount: totalPositionAmount, isLending: true },
    actualWithdrawAmount,
    withdrawBank.mintDecimals
  );

  const cuRequestIxs = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: 1_200_000 }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1 }),
  ];

  let amountToDeposit: number;
  let swapInstructions: TransactionInstruction[] = [];
  let setupInstructions: TransactionInstruction[] = [];
  let swapLookupTables: AddressLookupTableAccount[] = [];
  let swapQuote: SwapQuoteResult | undefined;
  let sizeConstraintUsed = 0;

  // Build withdraw instruction
  let withdrawIxs: InstructionsWrapper;

  switch (withdrawOpts.withdrawBank.config.assetTag) {
    case AssetTag.KAMINO: {
      const reserve =
        bankMetadataMap[withdrawOpts.withdrawBank.address.toBase58()]?.kaminoStates?.reserveState;

      if (!reserve) {
        throw TransactionBuildingError.kaminoReserveNotFound(
          withdrawOpts.withdrawBank.address.toBase58(),
          withdrawOpts.withdrawBank.mint.toBase58(),
          withdrawOpts.withdrawBank.tokenSymbol
        );
      }

      // Sometimes the ctoken conversion can be off by a few basis points, this accounts for that
      const multiplier =
        assetShareValueMultiplierByBank.get(withdrawOpts.withdrawBank.address.toBase58()) ??
        new BigNumber(1);
      const adjustedAmount = new BigNumber(actualWithdrawAmount)
        .div(multiplier)
        .times(1.0001)
        .toNumber();

      withdrawIxs = await makeKaminoWithdrawIx({
        program,
        bank: withdrawBank,
        bankMap,
        tokenProgram: withdrawTokenProgram,
        cTokenAmount: adjustedAmount,
        marginfiAccount,
        authority: marginfiAccount.authority,
        reserve,
        bankMetadataMap,
        withdrawAll: isFullWithdraw,
        isSync: true,
        opts: {
          createAtas: false,
          wrapAndUnwrapSol: false,
          overrideInferAccounts,
        },
      });
      break;
    }
    case AssetTag.DRIFT: {
      const driftState = bankMetadataMap[withdrawOpts.withdrawBank.address.toBase58()]?.driftStates;

      if (!driftState) {
        throw TransactionBuildingError.driftStateNotFound(
          withdrawOpts.withdrawBank.address.toBase58(),
          withdrawOpts.withdrawBank.mint.toBase58(),
          withdrawOpts.withdrawBank.tokenSymbol
        );
      }

      withdrawIxs = await makeDriftWithdrawIx({
        program,
        bank: withdrawOpts.withdrawBank,
        bankMap,
        tokenProgram: withdrawOpts.tokenProgram,
        amount: actualWithdrawAmount,
        marginfiAccount,
        authority: marginfiAccount.authority,
        driftSpotMarket: driftState.spotMarketState,
        userRewards: driftState.userRewards,
        bankMetadataMap,
        withdrawAll: isFullWithdraw,
        isSync: false,
        opts: {
          createAtas: false,
          wrapAndUnwrapSol: false,
          overrideInferAccounts,
        },
      });
      break;
    }

    case AssetTag.JUPLEND: {
      const jupLendState =
        bankMetadataMap[withdrawOpts.withdrawBank.address.toBase58()]?.jupLendStates;

      if (!jupLendState) {
        throw TransactionBuildingError.jupLendStateNotFound(
          withdrawOpts.withdrawBank.address.toBase58(),
          withdrawOpts.withdrawBank.mint.toBase58(),
          withdrawOpts.withdrawBank.tokenSymbol
        );
      }

      withdrawIxs = await makeJuplendWithdrawIx({
        program,
        bank: withdrawBank,
        bankMap,
        tokenProgram: withdrawTokenProgram,
        amount: actualWithdrawAmount,
        marginfiAccount,
        authority: marginfiAccount.authority,
        jupLendingState: jupLendState.jupLendingState,
        bankMetadataMap,
        withdrawAll: isFullWithdraw,
        isSync: true,
        opts: {
          createAtas: false,
          wrapAndUnwrapSol: false,
          overrideInferAccounts,
        },
      });
      break;
    }

    default: {
      withdrawIxs = await makeWithdrawIx({
        program,
        bank: withdrawBank,
        bankMap,
        tokenProgram: withdrawTokenProgram,
        amount: actualWithdrawAmount,
        marginfiAccount,
        authority: marginfiAccount.authority,
        withdrawAll: isFullWithdraw,
        bankMetadataMap,
        isSync: true,
        opts: {
          createAtas: false,
          wrapAndUnwrapSol: false,
          overrideInferAccounts,
        },
      });
      break;
    }
  }

  // Handle same-mint case (no swap needed)
  if (depositBank.mint.equals(withdrawBank.mint)) {
    amountToDeposit = actualWithdrawAmount;
  } else {
    const destinationTokenAccount = getAssociatedTokenAddressSync(
      depositBank.mint,
      marginfiAccount.authority,
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

    // Get swap instructions
    const swapResponses = await getSwapIxsForFlashloan({
      inputMint: withdrawBank.mint.toBase58(),
      outputMint: depositBank.mint.toBase58(),
      amount: uiToNative(actualWithdrawAmount, withdrawBank.mintDecimals).toNumber(),
      swapMode: "ExactIn",
      authority: marginfiAccount.authority,
      connection,
      destinationTokenAccount,
      swapOpts,
      sizeConstraint: swapConstraints.sizeConstraint,
      maxSwapAccounts: swapConstraints.maxSwapWritableAccounts,
      maxSwapTotalAccounts: swapConstraints.maxSwapTotalAccounts,
    });
    sizeConstraintUsed = swapConstraints.sizeConstraint;

    amountToDeposit = nativeToUi(
      swapResponses.quoteResponse.otherAmountThreshold,
      depositBank.mintDecimals
    );
    swapInstructions = swapResponses.swapInstructions;
    setupInstructions = swapResponses.setupInstructions;
    swapLookupTables = swapResponses.addressLookupTableAddresses;
    swapQuote = swapResponses.quoteResponse;
  }

  // Build deposit instruction
  let depositIxs: InstructionsWrapper;

  switch (depositBank.config.assetTag) {
    case AssetTag.KAMINO: {
      const reserve = bankMetadataMap[depositBank.address.toBase58()]?.kaminoStates?.reserveState;

      if (!reserve) {
        throw TransactionBuildingError.kaminoReserveNotFound(
          depositBank.address.toBase58(),
          depositBank.mint.toBase58(),
          depositBank.tokenSymbol
        );
      }

      depositIxs = await makeKaminoDepositIx({
        program,
        bank: depositBank,
        tokenProgram: depositTokenProgram,
        amount: amountToDeposit,
        accountAddress: marginfiAccount.address,
        authority: marginfiAccount.authority,
        group: marginfiAccount.group,
        reserve,
        opts: {
          wrapAndUnwrapSol: false,
          overrideInferAccounts,
        },
      });
      break;
    }
    case AssetTag.DRIFT: {
      const driftState = bankMetadataMap[depositBank.address.toBase58()]?.driftStates;

      if (!driftState) {
        throw TransactionBuildingError.driftStateNotFound(
          depositBank.address.toBase58(),
          depositBank.mint.toBase58(),
          depositBank.tokenSymbol
        );
      }

      const driftMarketIndex = driftState.spotMarketState.marketIndex;
      const driftOracle = driftState.spotMarketState.oracle;

      depositIxs = await makeDriftDepositIx({
        program,
        bank: depositBank,
        tokenProgram: depositTokenProgram,
        amount: amountToDeposit,
        accountAddress: marginfiAccount.address,
        authority: marginfiAccount.authority,
        group: marginfiAccount.group,
        driftMarketIndex,
        driftOracle,
        opts: {
          wrapAndUnwrapSol: false,
          overrideInferAccounts,
        },
      });
      break;
    }
    case AssetTag.JUPLEND: {
      depositIxs = await makeJuplendDepositIx({
        program,
        bank: depositBank,
        tokenProgram: depositTokenProgram,
        amount: amountToDeposit,
        accountAddress: marginfiAccount.address,
        authority: marginfiAccount.authority,
        group: marginfiAccount.group,
        opts: {
          wrapAndUnwrapSol: false,
          overrideInferAccounts,
        },
      });
      break;
    }
    default: {
      depositIxs = await makeDepositIx({
        program,
        bank: depositBank,
        tokenProgram: depositTokenProgram,
        amount: amountToDeposit,
        accountAddress: marginfiAccount.address,
        authority: marginfiAccount.authority,
        group: marginfiAccount.group,
        opts: {
          wrapAndUnwrapSol: false,
          overrideInferAccounts,
        },
      });
      break;
    }
  }

  const luts = [...(addressLookupTableAccounts ?? []), ...swapLookupTables];

  const allNonFlIxs = [
    ...cuRequestIxs,
    ...withdrawIxs.instructions,
    ...swapInstructions,
    ...depositIxs.instructions,
  ];

  if (swapInstructions.length > 0) {
    compileFlashloanPrecheck({
      allIxs: allNonFlIxs,
      payer: marginfiAccount.authority,
      luts,
      sizeConstraint: sizeConstraintUsed,
      swapIxCount: swapInstructions.length,
      swapLutCount: swapLookupTables.length,
    });
  }

  // Wallets add a priority fee ix by default breaking the flashloan tx so we need to add a placeholder priority fee ix
  // docs: https://docs.phantom.app/developer-powertools/solana-priority-fees
  // Solflare requires you to also include the set compute unit price to avoid transaction rejection on flashloans.
  const flashloanTx = await makeFlashLoanTx({
    program,
    marginfiAccount,
    bankMap,
    addressLookupTableAccounts: luts,
    blockhash,
    ixs: allNonFlIxs,
    isSync: true,
  });

  const txSize = getTxSize(flashloanTx);
  const writableKeys = getWritableAccountKeys(flashloanTx);
  const totalKeys = getTotalAccountKeys(flashloanTx);

  if (
    txSize > MAX_TX_SIZE ||
    writableKeys > MAX_WRITABLE_ACCOUNTS ||
    totalKeys > MAX_ACCOUNT_LOCKS
  ) {
    throw TransactionBuildingError.swapSizeExceededLoop(
      txSize,
      writableKeys,
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
