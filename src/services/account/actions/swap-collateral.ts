import {
  AddressLookupTableAccount,
  ComputeBudgetProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { BigNumber } from "bignumber.js";

import {
  runSwapEngine,
  swapEngineProvidersFromOpts,
  swapEngineQuoteFieldsFromOpts,
} from "../services/swap-engine";
import { MakeSwapCollateralTxParams, SwapQuoteResult } from "../types";
import {
  isWholePosition,
  computeFlashloanSwapConstraints,
  compileFlashloanPrecheck,
  patchDepositAmount,
  isDepositIx,
  BridgeOpts,
  BridgedTxResult,
  resolveTokenProgramForMint,
  selectSwapBridges,
  sharedBridgeLegContext,
  tryBridgeCandidates,
} from "../utils";

import { makeSetupIx } from "./account-lifecycle";
import { composeBridgedSwap, mergeBridgeQuotes } from "./bridge-swap";
import {
  makeDepositIx,
  makeDriftDepositIx,
  makeJuplendDepositIx,
  makeKaminoDepositIx,
} from "./deposit";
import { makeFlashLoanTx } from "./flash-loan";
import {
  makeDriftWithdrawIx,
  makeJuplendWithdrawIx,
  makeKaminoWithdrawIx,
  makeWithdrawIx,
} from "./withdraw";

import { MAX_TX_SIZE, MAX_ACCOUNT_LOCKS } from "~/constants";
import { isDecomposableSwapError, TransactionBuildingError } from "~/errors";
import { AssetTag } from "~/services/bank";
import { makeRefreshIntegrationBanksIxs, makeSmartCrankSwbFeedIx } from "~/services/price";
import {
  addTransactionMetadata,
  ExtendedV0Transaction,
  getTxSize,
  getTotalAccountKeys,
  InstructionsWrapper,
  splitInstructionsToFitTransactions,
  TransactionType,
} from "~/services/transaction";
import { nativeToUi, uiToNative } from "~/utils";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "~/vendor/spl";

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
  /** true → send as ONE atomic Jito bundle (integration refreshes go stale within a slot);
   *  false → sequential sends are safe (cranked oracles allow ≥ ~1 min staleness). */
  mustBeAtomicBundle: boolean;
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

  // Both banks are excluded from the jup/drift updates (withdraw/deposit ixs update them
  // via CPI); kamino has no cpi so both banks are included in the refresh instead
  const refreshIntegrationIxs = makeRefreshIntegrationBanksIxs(
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

  const additionalTxs: ExtendedV0Transaction[] = [];

  // If ATAs, additional instructions, or refreshes are needed, add them
  if (setupIxs.length > 0 || refreshIntegrationIxs.instructions.length > 0) {
    const ixs = [...setupIxs, ...refreshIntegrationIxs.instructions];
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
    mustBeAtomicBundle: refreshIntegrationIxs.instructions.length > 0,
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
  swapEngineRunner,
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
        isSync: false,
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
        isSync: false,
        opts: {
          createAtas: false,
          wrapAndUnwrapSol: false,
          overrideInferAccounts,
        },
      });
      break;
    }
  }

  // Deferred-swap: when a swap is needed the deposit is seeded with a placeholder amount
  // (its byte/account footprint is amount-independent) and byte-patched to the real swap
  // output after the engine runs. Same-mint deposits the exact withdrawn amount.
  const swapNeeded = !depositBank.mint.equals(withdrawBank.mint);
  const amountToDeposit = swapNeeded ? 0 : actualWithdrawAmount;

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

  if (swapNeeded) {
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
    sizeConstraintUsed = swapConstraints.sizeConstraint;

    const runEngine = swapEngineRunner ?? runSwapEngine;
    const engineResult = await runEngine({
      inputMint: withdrawBank.mint.toBase58(),
      outputMint: depositBank.mint.toBase58(),
      amountNative: uiToNative(actualWithdrawAmount, withdrawBank.mintDecimals).toNumber(),
      inputDecimals: withdrawBank.mintDecimals,
      outputDecimals: depositBank.mintDecimals,
      ...swapEngineQuoteFieldsFromOpts(swapOpts),
      taker: marginfiAccount.authority,
      destinationTokenAccount,
      connection,
      footprint: {
        instructions: [...cuRequestIxs, ...withdrawIxs.instructions, ...depositIxs.instructions],
        luts: addressLookupTableAccounts ?? [],
        payer: marginfiAccount.authority,
        sizeConstraint: swapConstraints.sizeConstraint,
        maxSwapTotalAccounts: swapConstraints.maxSwapTotalAccounts,
      },
      providers: swapEngineProvidersFromOpts(swapOpts),
    });

    // Patch the seeded deposit to the real (minimum guaranteed) swap output.
    const depositIxToPatch = depositIxs.instructions.find(isDepositIx);
    if (!depositIxToPatch) {
      throw new Error("swap-collateral: could not locate deposit instruction for amount patching");
    }
    patchDepositAmount(depositIxToPatch, engineResult.outputAmountNative);

    swapInstructions = engineResult.swapInstructions;
    setupInstructions = engineResult.setupInstructions;
    swapLookupTables = engineResult.swapLuts;
    swapQuote = engineResult.quoteResponse;
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

// ----------------------------------------------------------------------------
// Bridged (double-hop) fallback
// ----------------------------------------------------------------------------

export interface MakeBridgedSwapCollateralTxParams extends MakeSwapCollateralTxParams {
  bridgeOpts?: BridgeOpts;
}

// Headroom (native units) between the second leg's swap input and the first leg's bridge min-out.
// The swap input must never exceed what the withdraw actually delivers: marginfi share-rounding on
// the deposit→withdraw round-trip can come back a lamport short, and the UI-number amount
// round-trip can floor another. A few native units — value-invisible for any real token.
const SECOND_LEG_ROUNDING_HEADROOM_NATIVE = 10;

/**
 * {@link makeSwapCollateralTx} with a transparent bridged fallback: if the direct swap `A → C`
 * can't fit one tx or has no route, decompose it into `A → bridge` + `bridge → C` through a
 * high-liquidity bridge collateral, composed into one atomic bundle.
 */
export async function makeBridgedSwapCollateralTx(
  params: MakeBridgedSwapCollateralTxParams
): Promise<BridgedTxResult> {
  const { bridgeOpts, ...directParams } = params;
  try {
    return await makeSwapCollateralTx(directParams);
  } catch (directError) {
    if (!isDecomposableSwapError(directError)) throw directError;
    // A pinned route (swapOpts.swapIxs) belongs to the direct pair and cannot be spliced into
    // SDK-composed legs — never attempt the bridged fallback with one.
    if (directParams.swapOpts.swapIxs) throw directError;
    const bridged = await tryBridgedCollateralSwap(directParams, bridgeOpts);
    if (bridged) return bridged;
    throw directError;
  }
}

async function tryBridgedCollateralSwap(
  params: MakeSwapCollateralTxParams,
  bridgeOpts: BridgeOpts | undefined
): Promise<BridgedTxResult | null> {
  const sourceBank = params.withdrawOpts.withdrawBank;
  const destinationBank = params.depositOpts.depositBank;
  const withdrawAmount =
    params.withdrawOpts.withdrawAmount ?? params.withdrawOpts.totalPositionAmount;
  // A collateral swap DEPOSITS the bridge → skip any candidate the account is borrowing.
  const { usableBridgeBanks, conflictingBridgeBanks } = selectSwapBridges({
    sourceMint: sourceBank.mint,
    destinationMint: destinationBank.mint,
    bankMap: params.bankMap,
    marginfiAccount: params.marginfiAccount,
    bridgeTokenSide: "deposit",
    bridgeCandidateMints: bridgeOpts?.bridgeCandidateMints,
  });

  const tokenProgramCache = new Map(bridgeOpts?.tokenProgramByMint);
  return tryBridgeCandidates({
    usableBridgeBanks,
    conflictingBridgeBanks,
    bridgeTokenSide: "deposit",
    abortSignal: bridgeOpts?.abortSignal,
    buildBundleThroughBridge: async (bridgeBank) => {
      const bridgeTokenProgram = await resolveTokenProgramForMint(
        bridgeBank.mint,
        params.connection,
        tokenProgramCache
      );

      // First leg: A → bridge (deposits min-out bridge collateral).
      const firstLeg = await makeSwapCollateralTx({
        ...sharedBridgeLegContext(params),
        withdrawOpts: {
          totalPositionAmount: params.withdrawOpts.totalPositionAmount,
          withdrawAmount,
          withdrawBank: sourceBank,
          tokenProgram: params.withdrawOpts.tokenProgram,
        },
        depositOpts: { depositBank: bridgeBank, tokenProgram: bridgeTokenProgram },
      });
      if (!firstLeg.quoteResponse) return null;

      // The second leg spends (a rounding-headroom hair under) the first leg's GUARANTEED bridge
      // min-out, so it can't fail from first-leg slippage.
      const bridgeMinOutNative = Number(firstLeg.quoteResponse.otherAmountThreshold);
      const secondLegAmountNative = bridgeMinOutNative - SECOND_LEG_ROUNDING_HEADROOM_NATIVE;
      if (secondLegAmountNative <= 0) return null;
      const secondLegAmountUi = nativeToUi(secondLegAmountNative, bridgeBank.mintDecimals);

      // Without a pre-existing bridge deposit, the second leg withdraws ALL of the bridge (the
      // first leg deposited exactly min-out), so no dust position is ever left behind — the
      // headroom lamports land in the wallet ATA, not as a marginfi position. `withdrawAmount ===
      // totalPositionAmount` is what makes the builder emit a withdraw-all (the on-chain
      // withdraw-all pulls all shares regardless of the amount). With a pre-existing bridge
      // deposit, withdraw-all would sweep the user's own position into the swap, so keep the
      // partial withdraw there — the headroom merges invisibly into their existing position.
      const hasBridgeDeposit = params.marginfiAccount.balances.some(
        (b) => b.active && b.bankPk.equals(bridgeBank.address) && b.assetShares.gt(0)
      );

      const result = await composeBridgedSwap({
        firstLeg,
        // The second leg builds against the first leg's projected effect.
        buildSecondLeg: (projectedAccount) =>
          makeSwapCollateralTx({
            ...sharedBridgeLegContext(params),
            marginfiAccount: projectedAccount,
            withdrawOpts: {
              totalPositionAmount: hasBridgeDeposit
                ? nativeToUi(bridgeMinOutNative, bridgeBank.mintDecimals)
                : secondLegAmountUi,
              withdrawAmount: secondLegAmountUi,
              withdrawBank: bridgeBank,
              tokenProgram: bridgeTokenProgram,
            },
            depositOpts: params.depositOpts,
          }),
        marginfiAccount: params.marginfiAccount,
        program: params.program,
        banksMap: params.bankMap,
        assetShareValueMultiplierByBank: params.assetShareValueMultiplierByBank,
        feePayer: params.overrideInferAccounts?.authority ?? params.marginfiAccount.authority,
        maxBundleTxs: bridgeOpts?.maxBundleTxs,
      });
      if (!result) return null;

      return {
        transactions: result.transactions,
        actionTxIndex: result.transactions.length - 1,
        quoteResponse: mergeBridgeQuotes(result.firstLegQuote, result.secondLegQuote),
        bridgeMint: bridgeBank.mint,
        mustBeAtomicBundle: true,
      };
    },
  });
}
