import { BigNumber } from "bignumber.js";
import { QuoteResponse } from "@jup-ag/api";
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
  getAccountKeys,
  getTxSize,
  InstructionsWrapper,
  splitInstructionsToFitTransactions,
  TransactionType,
} from "~/services/transaction";
import {
  makeRefreshKaminoBanksIxs,
  makeSmartCrankSwbFeedIx,
  makeUpdateDriftMarketIxs,
} from "~/services/price";
import { AssetTag } from "~/services/bank";
import { TransactionBuildingError } from "~/errors";
import { MAX_TX_SIZE } from "~/constants";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "~/vendor/spl";
import { nativeToUi, uiToNative } from "~/utils";

import { getJupiterSwapIxsForFlashloan, isWholePosition } from "../utils";
import { MakeSwapCollateralTxParams } from "../types";

import { makeSetupIx } from "./account-lifecycle";
import { makeDriftWithdrawIx, makeKaminoWithdrawIx, makeWithdrawIx } from "./withdraw";
import { makeDepositIx, makeDriftDepositIx, makeKaminoDepositIx } from "./deposit";
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
 *   swapOpts: { jupiterOptions: { slippageMode: "DYNAMIC", slippageBps: 50 } },
 *   // ...
 * });
 */
export async function makeSwapCollateralTx(params: MakeSwapCollateralTxParams): Promise<{
  transactions: ExtendedV0Transaction[];
  actionTxIndex: number;
  quoteResponse: QuoteResponse | undefined;
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
    updateDriftMarketIxs.instructions.length > 0
  ) {
    const ixs = [
      ...setupIxs,
      ...kaminoRefreshIxs.instructions,
      ...updateDriftMarketIxs.instructions,
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

  const swapResult: {
    amountToDeposit: number;
    swapInstructions: TransactionInstruction[];
    setupInstructions: TransactionInstruction[];
    swapLookupTables: AddressLookupTableAccount[];
    quoteResponse?: QuoteResponse;
  }[] = [];

  const cuRequestIxs = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: 1_200_000 }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1 }),
  ];

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
      const adjustedAmount = new BigNumber(actualWithdrawAmount)
        .div(withdrawOpts.withdrawBank.assetShareValue)
        .times(1.0001)
        .toNumber();

      withdrawIxs = await makeKaminoWithdrawIx({
        program,
        bank: withdrawBank,
        bankMap,
        tokenProgram: withdrawTokenProgram,
        amount: adjustedAmount,
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
    swapResult.push({
      amountToDeposit: actualWithdrawAmount,
      swapInstructions: [],
      setupInstructions: [],
      swapLookupTables: [],
    });
  } else {
    const destinationTokenAccount = getAssociatedTokenAddressSync(
      depositBank.mint,
      marginfiAccount.authority,
      true,
      depositTokenProgram.equals(TOKEN_2022_PROGRAM_ID) ? TOKEN_2022_PROGRAM_ID : undefined
    );

    // Get Jupiter swap instructions - may return multiple routes
    const swapResponses = await getJupiterSwapIxsForFlashloan({
      quoteParams: {
        inputMint: withdrawBank.mint.toBase58(),
        outputMint: depositBank.mint.toBase58(),
        amount: uiToNative(actualWithdrawAmount, withdrawBank.mintDecimals).toNumber(),
        dynamicSlippage: swapOpts.jupiterOptions
          ? swapOpts.jupiterOptions.slippageMode === "DYNAMIC"
          : true,
        slippageBps: swapOpts.jupiterOptions?.slippageBps,
        swapMode: "ExactIn",
        platformFeeBps: swapOpts.jupiterOptions?.platformFeeBps,
        onlyDirectRoutes: swapOpts.jupiterOptions?.directRoutesOnly ?? false,
      },
      authority: marginfiAccount.authority,
      connection,
      destinationTokenAccount,
      configParams: swapOpts.jupiterOptions?.configParams,
    });

    swapResponses.forEach((response) => {
      const outAmountThreshold = nativeToUi(
        response.quoteResponse.otherAmountThreshold,
        depositBank.mintDecimals
      );

      swapResult.push({
        amountToDeposit: outAmountThreshold,
        swapInstructions: [response.swapInstruction],
        setupInstructions: response.setupInstructions,
        swapLookupTables: response.addressLookupTableAddresses,
        quoteResponse: response.quoteResponse,
      });
    });
  }

  // Ensure we have at least one swap route
  if (swapResult.length === 0) {
    throw new Error(
      `No swap routes found for ${withdrawBank.mint.toBase58()} -> ${depositBank.mint.toBase58()}`
    );
  }

  // Try each swap route until we find one that fits in transaction limits
  for (const [index, item] of swapResult.entries()) {
    const {
      amountToDeposit,
      swapInstructions,
      setupInstructions,
      swapLookupTables,
      quoteResponse,
    } = item;

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

    const flashloanParams = {
      program,
      marginfiAccount,
      bankMap,
      addressLookupTableAccounts: luts,
      blockhash,
    };

    // Wallets add a priority fee ix by default breaking the flashloan tx so we need to add a placeholder priority fee ix
    // docs: https://docs.phantom.app/developer-powertools/solana-priority-fees
    // Solflare requires you to also include the set compute unit price to avoid transaction rejection on flashloans.
    const flashloanTx = await makeFlashLoanTx({
      ...flashloanParams,
      ixs: [
        ...cuRequestIxs,
        ...withdrawIxs.instructions,
        ...swapInstructions,
        ...depositIxs.instructions,
      ],
      isSync: true,
    });

    const txSize = getTxSize(flashloanTx);
    const keySize = getAccountKeys(flashloanTx, luts);
    const isLast = index === swapResult.length - 1;

    if (txSize > MAX_TX_SIZE || keySize > 64) {
      if (isLast) {
        throw TransactionBuildingError.jupiterSwapSizeExceededLoop(txSize, keySize);
      } else {
        continue;
      }
    } else {
      return {
        flashloanTx,
        setupInstructions,
        swapQuote: quoteResponse,
        withdrawIxs,
        depositIxs,
      };
    }
  }

  throw new Error("Failed to build swap collateral flashloan tx");
}
