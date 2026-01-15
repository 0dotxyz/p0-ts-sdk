import {
  AddressLookupTableAccount,
  ComputeBudgetProgram,
  PublicKey,
  Transaction,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { BigNumber } from "bignumber.js";
import { QuoteResponse } from "@jup-ag/api";

import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  NATIVE_MINT,
  TOKEN_2022_PROGRAM_ID,
} from "~/vendor/spl";
import { nativeToUi, uiToNative } from "~/utils";
import instructions from "~/instructions";
import { AssetTag } from "~/services/bank";
import {
  addTransactionMetadata,
  ExtendedTransaction,
  ExtendedV0Transaction,
  InstructionsWrapper,
  makeWrapSolIxs,
  splitInstructionsToFitTransactions,
  TransactionType,
  getAccountKeys,
  getTxSize,
} from "~/services/transaction";
import { makeRefreshKaminoBanksIxs, makeSmartCrankSwbFeedIx } from "~/services/price";
import { MAX_TX_SIZE } from "~/constants";
import { TransactionBuildingError } from "~/errors";
import syncInstructions from "~/sync-instructions";

import { MakeRepayIxParams, MakeRepayTxParams, MakeRepayWithCollatTxParams } from "../types";
import { isWholePosition, getJupiterSwapIxsForFlashloan } from "../utils";

import { makeKaminoWithdrawIx, makeWithdrawIx } from "./withdraw";
import { makeFlashLoanTx } from "./flash-loan";
import { makeSetupIx } from "./account-lifecycle";

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
 * @param params.program - The Marginfi program instance
 * @param params.bank - The bank to repay to
 * @param params.tokenProgram - The token program ID (TOKEN_PROGRAM or TOKEN_2022_PROGRAM)
 * @param params.amount - The amount to repay in UI units
 * @param params.authority - The authority/signer public key
 * @param params.accountAddress - The Marginfi account address
 * @param params.repayAll - Whether to repay the entire liability (default: false)
 * @param params.opts - Optional configuration
 * @param params.opts.wrapAndUnwrapSol - Whether to wrap SOL to wSOL (default: true)
 * @param params.opts.wSolBalanceUi - Existing wSOL balance to combine with native SOL (default: 0)
 * @param params.opts.overrideInferAccounts - Optional account overrides for testing/special cases
 *
 * @returns Promise resolving to InstructionsWrapper containing the repay instructions
 */
export async function makeRepayIx({
  program,
  bank,
  tokenProgram,
  amount,
  authority,
  accountAddress,
  repayAll = false,
  isSync = false,
  opts = {},
}: MakeRepayIxParams) {
  const wrapAndUnwrapSol = opts.wrapAndUnwrapSol ?? true;
  const wSolBalanceUi = opts.wSolBalanceUi ?? 0;

  const repayIxs = [];

  // Add repay-related instructions
  const userAta = getAssociatedTokenAddressSync(bank.mint, authority, true, tokenProgram); // We allow off curve addresses here to support Fuse.

  const remainingAccounts = tokenProgram.equals(TOKEN_2022_PROGRAM_ID)
    ? [{ pubkey: bank.mint, isSigner: false, isWritable: false }]
    : [];

  if (bank.mint.equals(NATIVE_MINT) && wrapAndUnwrapSol) {
    repayIxs.push(...makeWrapSolIxs(authority, new BigNumber(amount).minus(wSolBalanceUi)));
  }

  const repayIx =
    !isSync || !opts.overrideInferAccounts?.group
      ? await instructions.makeRepayIx(
          program,
          {
            marginfiAccount: accountAddress,
            signerTokenAccount: userAta,
            bank: bank.address,
            tokenProgram: tokenProgram,
            authority: opts.overrideInferAccounts?.authority ?? authority,
            group: opts.overrideInferAccounts?.group,
            liquidityVault: opts.overrideInferAccounts?.liquidityVault,
          },
          { amount: uiToNative(amount, bank.mintDecimals), repayAll },
          remainingAccounts
        )
      : syncInstructions.makeRepayIx(
          program.programId,
          {
            marginfiAccount: accountAddress,
            signerTokenAccount: userAta,
            bank: bank.address,
            tokenProgram: tokenProgram,
            authority: opts.overrideInferAccounts?.authority ?? authority,
            group: opts.overrideInferAccounts?.group,
          },
          { amount: uiToNative(amount, bank.mintDecimals), repayAll },
          remainingAccounts
        );
  repayIxs.push(repayIx);

  return {
    instructions: repayIxs,
    keys: [],
  };
}

/**
 * Creates a complete repay transaction ready to be signed and sent.
 *
 * This function builds a full transaction that includes:
 * - SOL wrapping instructions if repaying native SOL
 * - The actual repay instruction to return assets to the Marginfi bank
 * - Proper support for Token-2022 tokens
 * - Support for full or partial repayment
 *
 * The transaction is constructed as a legacy Transaction with proper metadata
 * and is ready to be signed by the authority and submitted to the network.
 *
 * @param params - The parameters for creating the repay transaction
 * @param params.luts - Address lookup tables for transaction compression
 * @param params.program - The Marginfi program instance
 * @param params.bank - The bank to repay to
 * @param params.tokenProgram - The token program ID (TOKEN_PROGRAM or TOKEN_2022_PROGRAM)
 * @param params.amount - The amount to repay in UI units
 * @param params.authority - The authority/signer public key
 * @param params.accountAddress - The Marginfi account address
 * @param params.repayAll - Whether to repay the entire liability (default: false)
 * @param params.opts - Optional configuration (wrapping, overrides, etc.)
 *
 * @returns Promise resolving to an ExtendedTransaction with metadata
 */
export async function makeRepayTx(params: MakeRepayTxParams): Promise<ExtendedTransaction> {
  const { luts, ...depositIxParams } = params;

  const ixs = await makeRepayIx(depositIxParams);
  const tx = new Transaction().add(...ixs.instructions);
  tx.feePayer = params.authority;

  const solanaTx = addTransactionMetadata(tx, {
    type: TransactionType.REPAY,
    signers: ixs.keys,
    addressLookupTables: luts,
  });
  return solanaTx;
}

export async function makeRepayWithCollatTx(params: MakeRepayWithCollatTxParams) {
  const {
    program,
    marginfiAccount,
    bankMap,
    withdrawOpts,
    repayOpts,
    bankMetadataMap,
    addressLookupTableAccounts,
    connection,
    oraclePrices,
    crossbarUrl,
  } = params;

  const blockhash = (await connection.getLatestBlockhash("confirmed")).blockhash;

  // Create atas if needed
  const setupIxs = await makeSetupIx({
    connection,
    authority: marginfiAccount.authority,
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

  // Will only refresh kamino banks if any banks in the portfolio are kamino
  const kaminoRefreshIxs = makeRefreshKaminoBanksIxs(
    marginfiAccount,
    bankMap,
    [withdrawOpts.withdrawBank.address, repayOpts.repayBank.address],
    bankMetadataMap
  );

  const { flashloanTx, setupInstructions, swapQuote, amountToRepay, withdrawIxs, repayIxs } =
    await buildRepayWithCollatFlashloanTx({
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
        mintKey?.equals(withdrawOpts.withdrawBank.mint) ||
        mintKey?.equals(repayOpts.repayBank.mint)
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
    instructions: [...withdrawIxs.instructions, ...repayIxs.instructions],
    program,
    connection,
    crossbarUrl,
  });

  let additionalTxs: ExtendedV0Transaction[] = [];

  // if atas are needed, add them
  if (setupIxs.length > 0 || kaminoRefreshIxs.instructions.length > 0) {
    const ixs = [...setupIxs, ...kaminoRefreshIxs.instructions];
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
  return { transactions, swapQuote, amountToRepay };
}

async function buildRepayWithCollatFlashloanTx({
  program,
  marginfiAccount,
  bankMap,
  withdrawOpts,
  repayOpts,
  bankMetadataMap,
  addressLookupTableAccounts,
  connection,
  swapOpts,
  overrideInferAccounts,
  blockhash,
}: MakeRepayWithCollatTxParams & { blockhash: string }) {
  const swapResult: {
    amountToRepay: number;
    swapInstructions: TransactionInstruction[];
    setupInstructions: TransactionInstruction[];
    swapLookupTables: AddressLookupTableAccount[];
    quoteResponse?: QuoteResponse;
  }[] = [];

  const cuRequestIxs = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: 1_200_000 }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1 }),
  ];

  if (repayOpts.repayBank.mint.equals(withdrawOpts.withdrawBank.mint)) {
    // No swap needed, you just withdraw and repay the same mint
    swapResult.push({
      amountToRepay: withdrawOpts.withdrawAmount,
      swapInstructions: [],
      setupInstructions: [],
      swapLookupTables: [],
    });
  } else {
    const destinationTokenAccount = getAssociatedTokenAddressSync(
      new PublicKey(repayOpts.repayBank.mint),
      marginfiAccount.authority,
      true,
      repayOpts.tokenProgram.equals(TOKEN_2022_PROGRAM_ID) ? TOKEN_2022_PROGRAM_ID : undefined
    );

    // Get Jupiter swap instruction using calculated available TX size
    const swapResponse = await getJupiterSwapIxsForFlashloan({
      quoteParams: {
        inputMint: withdrawOpts.withdrawBank.mint.toBase58(),
        outputMint: repayOpts.repayBank.mint.toBase58(),
        amount: uiToNative(
          withdrawOpts.withdrawAmount,
          withdrawOpts.withdrawBank.mintDecimals
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
      const { swapInstruction, addressLookupTableAddresses, quoteResponse } = response;
      const outAmount = nativeToUi(quoteResponse.outAmount, repayOpts.repayBank.mintDecimals);
      const outAmountThreshold = nativeToUi(
        quoteResponse.otherAmountThreshold,
        repayOpts.repayBank.mintDecimals
      );

      const amountToRepay =
        outAmount > repayOpts.totalPositionAmount
          ? repayOpts.totalPositionAmount
          : outAmountThreshold;

      swapResult.push({
        amountToRepay,
        swapInstructions: [swapInstruction],
        setupInstructions: [],
        swapLookupTables: addressLookupTableAddresses,
        quoteResponse,
      });
    });
  }

  let withdrawIxs: InstructionsWrapper;

  // Logic to determine if the withdraw bank is kamino
  if (withdrawOpts.withdrawBank.config.assetTag === AssetTag.KAMINO) {
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
    const adjustedAmount = new BigNumber(withdrawOpts.withdrawAmount)
      .div(withdrawOpts.withdrawBank.assetShareValue)
      .times(1.0001)
      .toNumber();

    withdrawIxs = await makeKaminoWithdrawIx({
      program,
      bank: withdrawOpts.withdrawBank,
      bankMap,
      tokenProgram: withdrawOpts.tokenProgram,
      amount: adjustedAmount,
      marginfiAccount,
      authority: marginfiAccount.authority,
      reserve,
      bankMetadataMap,
      withdrawAll: isWholePosition(
        {
          amount: withdrawOpts.totalPositionAmount,
          isLending: true,
        },
        withdrawOpts.withdrawAmount,
        withdrawOpts.withdrawBank.mintDecimals
      ),
      isSync: true,
      opts: {
        createAtas: false,
        wrapAndUnwrapSol: false,
        overrideInferAccounts,
      },
    });
  } else {
    withdrawIxs = await makeWithdrawIx({
      program,
      bank: withdrawOpts.withdrawBank,
      bankMap,
      tokenProgram: withdrawOpts.tokenProgram,
      amount: withdrawOpts.withdrawAmount,
      marginfiAccount,
      authority: marginfiAccount.authority,
      withdrawAll: isWholePosition(
        {
          amount: withdrawOpts.totalPositionAmount,
          isLending: true,
        },
        withdrawOpts.withdrawAmount,
        withdrawOpts.withdrawBank.mintDecimals
      ),
      bankMetadataMap,
      isSync: true,
      opts: {
        createAtas: false,
        wrapAndUnwrapSol: false,
        overrideInferAccounts,
      },
    });
  }

  for (const [index, item] of swapResult.entries()) {
    const { amountToRepay, swapInstructions, setupInstructions, swapLookupTables, quoteResponse } =
      item;

    const repayIxs = await makeRepayIx({
      program,
      bank: repayOpts.repayBank,
      tokenProgram: repayOpts.tokenProgram,
      amount: amountToRepay,
      accountAddress: marginfiAccount.address,
      authority: marginfiAccount.authority,
      repayAll: isWholePosition(
        {
          amount: repayOpts.totalPositionAmount,
          isLending: true,
        },
        amountToRepay,
        repayOpts.repayBank.mintDecimals
      ),
      isSync: true,
      opts: {
        wrapAndUnwrapSol: false,
        overrideInferAccounts,
      },
    });

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
        ...withdrawIxs.instructions,
        ...swapInstructions,
        ...repayIxs.instructions,
      ],
      isSync: true,
    });

    const txSize = getTxSize(flashloanTx);
    const keySize = getAccountKeys(flashloanTx, luts);
    const isLast = index === swapResult.length - 1;

    if (txSize > MAX_TX_SIZE || keySize > 64) {
      if (isLast) {
        throw TransactionBuildingError.jupiterSwapSizeExceededRepay(txSize, keySize);
      } else {
        continue;
      }
    } else {
      return {
        flashloanTx,
        setupInstructions,
        swapQuote: quoteResponse,
        withdrawIxs,
        repayIxs,
        amountToRepay,
      };
    }
  }

  throw new Error("Failed to build repay with collateral flashloan tx");
}
