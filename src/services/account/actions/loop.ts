import { BigNumber } from "bignumber.js";
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
  getWritableAccountKeys,
  getTxSize,
  InstructionsWrapper,
  makeWrapSolIxs,
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
import { MAX_TX_SIZE, MAX_WRITABLE_ACCOUNTS } from "~/constants";
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from "~/vendor/spl";

import {
  getSwapIxsForFlashloan,
  computeFlashloanSwapConstraints,
  compileFlashloanPrecheck,
} from "../utils";
import { MakeLoopTxParams, SwapQuoteResult } from "../types";

import {
  makeDepositIx,
  makeDriftDepositIx,
  makeJuplendDepositIx,
  makeKaminoDepositIx,
} from "./deposit";
import { makeBorrowIx } from "./borrow";
import { makeSetupIx } from "./account-lifecycle";
import { makeFlashLoanTx } from "./flash-loan";
import { getAssociatedTokenAddressSync, NATIVE_MINT } from "~/vendor/spl";
import { nativeToUi, uiToNative } from "~/utils";

export async function makeLoopTx(params: MakeLoopTxParams): Promise<{
  transactions: ExtendedV0Transaction[];
  actionTxIndex: number;
  quoteResponse: SwapQuoteResult | undefined;
}> {
  const {
    program,
    marginfiAccount,
    bankMap,
    depositOpts,
    borrowOpts,
    bankMetadataMap,
    addressLookupTableAccounts,
    connection,
    oraclePrices,
    crossbarUrl,
    additionalIxs = [],
  } = params;

  const blockhash = (await connection.getLatestBlockhash("confirmed")).blockhash;

  const setupIxs = await makeSetupIx({
    connection,
    authority: marginfiAccount.authority,
    tokens: [
      {
        mint: borrowOpts.borrowBank.mint,
        tokenProgram: borrowOpts.tokenProgram,
      },
      {
        mint: depositOpts.depositBank.mint,
        tokenProgram: depositOpts.tokenProgram,
      },
    ],
  });

  const updateJupLendRateIxs = makeUpdateJupLendRateIxs(
    params.marginfiAccount,
    params.bankMap,
    [depositOpts.depositBank.address],
    params.bankMetadataMap
  );

  const updateDriftMarketIxs = makeUpdateDriftMarketIxs(
    params.marginfiAccount,
    params.bankMap,
    [depositOpts.depositBank.address],
    params.bankMetadataMap
  );

  const kaminoRefreshIxs = makeRefreshKaminoBanksIxs(
    marginfiAccount,
    bankMap,
    [borrowOpts.borrowBank.address, depositOpts.depositBank.address],
    bankMetadataMap
  );

  const { flashloanTx, setupInstructions, swapQuote, amountToDeposit, depositIxs, borrowIxs } =
    await buildLoopFlashloanTx({
      ...params,
      blockhash,
    });

  const jupiterSetupInstructions = setupInstructions.filter((ix) => {
    // filter out compute budget instructions
    if (ix.programId.equals(ComputeBudgetProgram.programId)) {
      return false;
    }

    if (ix.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID)) {
      // key 3 is always mint in create ata
      const mintKey = ix.keys[3]?.pubkey;

      if (
        mintKey?.equals(depositOpts.depositBank.mint) ||
        mintKey?.equals(borrowOpts.borrowBank.mint)
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
    assetShareValueMultiplierByBank: params.assetShareValueMultiplierByBank,
    instructions: [...borrowIxs.instructions, ...depositIxs.instructions],
    program,
    connection,
    crossbarUrl,
  });

  let additionalTxs: ExtendedV0Transaction[] = [];

  // wrap sol if needed
  if (depositOpts.depositBank.mint.equals(NATIVE_MINT) && depositOpts.inputDepositAmount) {
    setupIxs.push(
      ...makeWrapSolIxs(marginfiAccount.authority, new BigNumber(depositOpts.inputDepositAmount))
    );
  }

  // if atas are needed, add them
  if (
    setupIxs.length > 0 ||
    additionalIxs.length > 0 ||
    kaminoRefreshIxs.instructions.length > 0 ||
    updateDriftMarketIxs.instructions.length > 0 ||
    updateJupLendRateIxs.instructions.length > 0
  ) {
    const ixs = [
      ...additionalIxs,
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

  // if crank is needed, add it
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

async function buildLoopFlashloanTx({
  program,
  marginfiAccount,
  bankMap,
  borrowOpts,
  depositOpts,
  bankMetadataMap,
  addressLookupTableAccounts,
  connection,
  swapOpts,
  overrideInferAccounts,
  blockhash,
}: MakeLoopTxParams & { blockhash: string }) {
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

  if (depositOpts.depositBank.mint.equals(borrowOpts.borrowBank.mint)) {
    // No swap needed, you just borrow and deposit the same mint
    amountToDeposit =
      borrowOpts.borrowAmount +
      (depositOpts.loopMode === "DEPOSIT" ? depositOpts.inputDepositAmount : 0);
  } else {
    const destinationTokenAccount = getAssociatedTokenAddressSync(
      new PublicKey(depositOpts.depositBank.mint),
      marginfiAccount.authority,
      true,
      depositOpts.tokenProgram.equals(TOKEN_2022_PROGRAM_ID) ? TOKEN_2022_PROGRAM_ID : undefined
    );
    const swapConstraints = await computeFlashloanSwapConstraints({
      program,
      marginfiAccount,
      bankMap,
      bankMetadataMap,
      addressLookupTableAccounts: addressLookupTableAccounts ?? [],
      primaryIx: {
        type: "borrow",
        bank: borrowOpts.borrowBank,
        tokenProgram: borrowOpts.tokenProgram,
      },
      secondaryIx: {
        type: "deposit",
        bank: depositOpts.depositBank,
        tokenProgram: depositOpts.tokenProgram,
      },
      overrideInferAccounts,
    });

    // Get swap instructions using provider router
    const swapResponse = await getSwapIxsForFlashloan({
      inputMint: borrowOpts.borrowBank.mint.toBase58(),
      outputMint: depositOpts.depositBank.mint.toBase58(),
      amount: uiToNative(borrowOpts.borrowAmount, borrowOpts.borrowBank.mintDecimals).toNumber(),
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

    const outAmountThreshold = nativeToUi(
      swapResponse.quoteResponse.otherAmountThreshold,
      depositOpts.depositBank.mintDecimals
    );

    amountToDeposit =
      outAmountThreshold +
      (depositOpts.loopMode === "DEPOSIT" ? depositOpts.inputDepositAmount : 0);
    swapInstructions = swapResponse.swapInstructions;
    setupInstructions = swapResponse.setupInstructions;
    swapLookupTables = swapResponse.addressLookupTableAddresses;
    swapQuote = swapResponse.quoteResponse;
  }

  const borrowIxs = await makeBorrowIx({
    program,
    bank: borrowOpts.borrowBank,
    bankMap,
    tokenProgram: borrowOpts.tokenProgram,
    amount: borrowOpts.borrowAmount,
    marginfiAccount,
    authority: marginfiAccount.authority,
    isSync: false,
    opts: {
      createAtas: false,
      wrapAndUnwrapSol: false,
      overrideInferAccounts,
    },
  });

  let depositIxs: InstructionsWrapper;

  switch (depositOpts.depositBank.config.assetTag) {
    case AssetTag.KAMINO: {
      const reserve =
        bankMetadataMap[depositOpts.depositBank.address.toBase58()]?.kaminoStates?.reserveState;

      if (!reserve) {
        throw TransactionBuildingError.kaminoReserveNotFound(
          depositOpts.depositBank.address.toBase58(),
          depositOpts.depositBank.mint.toBase58(),
          depositOpts.depositBank.tokenSymbol
        );
      }

      depositIxs = await makeKaminoDepositIx({
        program,
        bank: depositOpts.depositBank,
        tokenProgram: depositOpts.tokenProgram,
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
      const driftState = bankMetadataMap[depositOpts.depositBank.address.toBase58()]?.driftStates;

      if (!driftState) {
        throw TransactionBuildingError.driftStateNotFound(
          depositOpts.depositBank.address.toBase58(),
          depositOpts.depositBank.mint.toBase58(),
          depositOpts.depositBank.tokenSymbol
        );
      }

      const driftMarketIndex = driftState.spotMarketState.marketIndex;
      const driftOracle = driftState.spotMarketState.oracle;

      depositIxs = await makeDriftDepositIx({
        program,
        bank: depositOpts.depositBank,
        tokenProgram: depositOpts.tokenProgram,
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
        bank: depositOpts.depositBank,
        tokenProgram: depositOpts.tokenProgram,
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
        bank: depositOpts.depositBank,
        tokenProgram: depositOpts.tokenProgram,
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
    ...borrowIxs.instructions,
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

  // if cuRequestIxs are not present, priority fee ix is needed
  // wallets add a priority fee ix by default breaking the flashloan tx so we need to add a placeholder priority fee ix
  // docs: https://docs.phantom.app/developer-powertools/solana-priority-fees
  // Solflare requires you to also include the set compute unit price to avoid transaction rejection on flashloans.
  const flashloanTx = await makeFlashLoanTx({
    program,
    marginfiAccount,
    bankMap,
    addressLookupTableAccounts: luts,
    blockhash,
    ixs: allNonFlIxs,
  });

  const txSize = getTxSize(flashloanTx);
  const writableKeys = getWritableAccountKeys(flashloanTx);

  if (txSize > MAX_TX_SIZE || writableKeys > MAX_WRITABLE_ACCOUNTS) {
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
    borrowIxs,
    depositIxs,
    amountToDeposit,
  };
}
