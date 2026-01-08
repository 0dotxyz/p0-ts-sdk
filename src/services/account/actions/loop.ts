import { BigNumber } from "bignumber.js";
import { QuoteResponse } from "@jup-ag/api";
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
  ASSOCIATED_TOKEN_PROGRAM_ID,
  ExtendedV0Transaction,
  getAccountKeys,
  getAssociatedTokenAddressSync,
  getTxSize,
  InstructionsWrapper,
  MAX_TX_SIZE,
  NATIVE_MINT,
  nativeToUi,
  splitInstructionsToFitTransactions,
  TOKEN_2022_PROGRAM_ID,
  TransactionType,
  uiToNative,
} from "@mrgnlabs/mrgn-common";

import { makeWrapSolIxs } from "~/services/transaction";
import {
  makeRefreshKaminoBanksIxs,
  makeSmartCrankSwbFeedIx,
} from "~/services/price";
import { AssetTag } from "~/services/bank";
import { TransactionBuildingError } from "~/errors";

import { getJupiterSwapIxsForFlashloan } from "../utils";
import { MakeLoopTxParams } from "../types";

import { makeDepositIx, makeKaminoDepositIx } from "./deposit";
import { makeBorrowIx } from "./borrow";
import { makeSetupIx } from "./account-lifecycle";
import { makeFlashLoanTx } from "./flash-loan";

export async function makeLoopTx(params: MakeLoopTxParams): Promise<{
  transactions: ExtendedV0Transaction[];
  actionTxIndex: number;
  quoteResponse: QuoteResponse | undefined;
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

  const blockhash = (await connection.getLatestBlockhash("confirmed"))
    .blockhash;

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

  const kaminoRefreshIxs = makeRefreshKaminoBanksIxs(
    marginfiAccount,
    bankMap,
    [borrowOpts.borrowBank.address, depositOpts.depositBank.address],
    bankMetadataMap
  );

  const {
    flashloanTx,
    setupInstructions,
    swapQuote,
    amountToDeposit,
    depositIxs,
    borrowIxs,
  } = await buildLoopFlashloanTx({
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

  const { instructions: updateFeedIxs, luts: feedLuts } =
    await makeSmartCrankSwbFeedIx({
      marginfiAccount,
      bankMap,
      oraclePrices,
      instructions: [...borrowIxs.instructions, ...depositIxs.instructions],
      program,
      connection,
      crossbarUrl,
    });

  let additionalTxs: ExtendedV0Transaction[] = [];

  // wrap sol if needed
  if (
    depositOpts.depositBank.mint.equals(NATIVE_MINT) &&
    depositOpts.inputDepositAmount
  ) {
    setupIxs.push(
      ...makeWrapSolIxs(
        marginfiAccount.authority,
        new BigNumber(depositOpts.inputDepositAmount)
      )
    );
  }

  // if atas are needed, add them
  if (
    setupIxs.length > 0 ||
    additionalIxs.length > 0 ||
    kaminoRefreshIxs.instructions.length > 0
  ) {
    const ixs = [
      ...additionalIxs,
      ...setupIxs,
      ...kaminoRefreshIxs.instructions,
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

  if (depositOpts.depositBank.mint.equals(borrowOpts.borrowBank.mint)) {
    // No swap needed, you just borrow and deposit the same mint
    swapResult.push({
      amountToDeposit:
        borrowOpts.borrowAmount +
        (depositOpts.loopMode === "DEPOSIT"
          ? depositOpts.inputDepositAmount
          : 0),
      swapInstructions: [],
      setupInstructions: [],
      swapLookupTables: [],
    });
  } else {
    const destinationTokenAccount = getAssociatedTokenAddressSync(
      new PublicKey(depositOpts.depositBank.mint),
      marginfiAccount.authority,
      true,
      depositOpts.tokenProgram.equals(TOKEN_2022_PROGRAM_ID)
        ? TOKEN_2022_PROGRAM_ID
        : undefined
    );
    // Get Jupiter swap instruction using calculated available TX size
    const swapResponse = await getJupiterSwapIxsForFlashloan({
      quoteParams: {
        inputMint: borrowOpts.borrowBank.mint.toBase58(),
        outputMint: depositOpts.depositBank.mint.toBase58(),
        amount: uiToNative(
          borrowOpts.borrowAmount,
          borrowOpts.borrowBank.mintDecimals
        ).toNumber(),
        dynamicSlippage: swapOpts.jupiterOptions
          ? swapOpts.jupiterOptions.slippageMode === "DYNAMIC"
          : true,
        slippageBps: swapOpts.jupiterOptions?.slippageBps ?? undefined,
        swapMode: "ExactIn",
        platformFeeBps: swapOpts.jupiterOptions?.platformFeeBps ?? undefined,
        onlyDirectRoutes: swapOpts.jupiterOptions?.directRoutesOnly ?? false,
      },
      authority: marginfiAccount.authority,
      connection,
      destinationTokenAccount,
    });

    swapResponse.forEach((response) => {
      const outAmountThreshold = nativeToUi(
        response.quoteResponse.otherAmountThreshold,
        depositOpts.depositBank.mintDecimals
      );

      const amountToDeposit =
        outAmountThreshold +
        (depositOpts.loopMode === "DEPOSIT"
          ? depositOpts.inputDepositAmount
          : 0);

      swapResult.push({
        amountToDeposit,
        swapInstructions: [response.swapInstruction],
        setupInstructions: response.setupInstructions,
        swapLookupTables: response.addressLookupTableAddresses,
        quoteResponse: response.quoteResponse,
      });
    });
  }

  const borrowIxs = await makeBorrowIx({
    program,
    bank: borrowOpts.borrowBank,
    bankMap,
    tokenProgram: borrowOpts.tokenProgram,
    amount: borrowOpts.borrowAmount,
    marginfiAccount,
    authority: marginfiAccount.authority,
    bankMetadataMap,
    isSync: true,
    opts: {
      createAtas: false,
      wrapAndUnwrapSol: false,
      overrideInferAccounts,
    },
  });

  for (const [index, item] of swapResult.entries()) {
    const {
      amountToDeposit,
      swapInstructions,
      setupInstructions,
      swapLookupTables,
      quoteResponse,
    } = item;

    let depositIxs: InstructionsWrapper;

    if (depositOpts.depositBank.config.assetTag === AssetTag.KAMINO) {
      const reserve =
        bankMetadataMap[depositOpts.depositBank.address.toBase58()]
          ?.kaminoStates?.reserveState;

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
    } else {
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
    }

    const luts = [...(addressLookupTableAccounts ?? []), ...swapLookupTables];

    const flashloanParams = {
      program,
      marginfiAccount,
      bankMap,
      addressLookupTableAccounts: luts,
      blockhash,
    };

    // if cuRequestIxs are not present, priority fee ix is needed
    // wallets add a priority fee ix by default breaking the flashloan tx so we need to add a placeholder priority fee ix
    // docs: https://docs.phantom.app/developer-powertools/solana-priority-fees
    // Solflare requires you to also include the set compute unit price to avoid transaction rejection on flashloans.

    const flashloanTx = await makeFlashLoanTx({
      ...flashloanParams,
      ixs: [
        ...cuRequestIxs,
        ...borrowIxs.instructions,
        ...swapInstructions,
        ...depositIxs.instructions,
      ],
    });

    const txSize = getTxSize(flashloanTx);
    const keySize = getAccountKeys(flashloanTx, luts);
    const isLast = index === swapResult.length - 1;

    if (txSize > MAX_TX_SIZE || keySize > 64) {
      if (isLast) {
        throw TransactionBuildingError.jupiterSwapSizeExceededLoop(
          txSize,
          keySize
        );
      } else {
        continue;
      }
    } else {
      return {
        flashloanTx,
        setupInstructions,
        swapQuote: quoteResponse,
        borrowIxs,
        depositIxs,
        amountToDeposit,
      };
    }
  }

  throw new Error("Failed to build repay with collateral flashloan tx");
}
