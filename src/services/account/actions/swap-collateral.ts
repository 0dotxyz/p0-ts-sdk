import type {
  AddressesByLookupTableAddress,
  BlockhashLifetimeConstraint,
  Instruction,
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
import { makeRefreshIntegrationBanksIxs } from "~/services/price";
import {
  getTotalAccountKeys,
  getTxSize,
  SolanaTransaction,
  splitInstructionsToFitTransactions,
  TransactionType,
} from "~/services/transaction";
import { nativeToUi, uiToNative } from "~/utils";

/**
 * Creates transactions to swap one collateral position to another using a flash loan.
 *
 * This allows users to change their collateral type (e.g., JitoSOL -> mSOL) without
 * withdrawing and affecting their health during the swap.
 *
 * @example
 * const { transactions, actionTxIndex, quoteResponse } = await makeSwapCollateralTx({
 *   programAddress,
 *   marginfiAccount,
 *   authority,
 *   rpc,
 *   bankMap,
 *   withdrawOpts: { totalPositionAmount: 10, withdrawBank: jitoSolBank, tokenProgram },
 *   depositOpts: { depositBank: mSolBank, tokenProgram },
 *   swapOpts: { swapConfig: { provider: SwapProvider.JUPITER, slippageMode: "DYNAMIC", slippageBps: 50, platformFeeBps: 0 } },
 *   // ...
 * });
 */
export async function makeSwapCollateralTx(params: MakeSwapCollateralTxParams): Promise<{
  transactions: SolanaTransaction[];
  actionTxIndex: number;
  quoteResponse: SwapQuoteResult | undefined;
  /** true → send as ONE atomic Jito bundle (integration refreshes go stale within a slot);
   *  false → sequential sends are safe (cranked oracles allow ≥ ~1 min staleness). */
  mustBeAtomicBundle: boolean;
}> {
  const {
    marginfiAccount,
    authority,
    rpc,
    bankMap,
    withdrawOpts,
    depositOpts,
    bankMetadataMap,
    luts,
  } = params;

  const { value: latestBlockhash } = await rpc
    .getLatestBlockhash({ commitment: "confirmed" })
    .send();

  const setupIxs = await makeSetupIx({
    rpc,
    authority,
    tokens: [
      { mint: withdrawOpts.withdrawBank.mint, tokenProgram: withdrawOpts.tokenProgram },
      { mint: depositOpts.depositBank.mint, tokenProgram: depositOpts.tokenProgram },
    ],
  });

  // Both banks are excluded from the jup/drift updates (withdraw/deposit ixs update them
  // via CPI); kamino has no cpi so both banks are included in the refresh instead
  const refreshIntegrationIxs = await makeRefreshIntegrationBanksIxs(
    marginfiAccount,
    bankMap,
    [withdrawOpts.withdrawBank.address, depositOpts.depositBank.address],
    bankMetadataMap
  );

  const { flashloanTx, setupInstructions, swapQuote } = await buildSwapCollateralFlashloanTx({
    ...params,
    latestBlockhash,
  });

  // Filter Jupiter setup instructions to avoid duplicates with our setup
  const jupiterSetupInstructions = setupInstructions.filter((ix) => {
    // Filter out compute budget instructions
    if (ix.programAddress === COMPUTE_BUDGET_PROGRAM_ADDRESS) {
      return false;
    }

    if (ix.programAddress === ASSOCIATED_TOKEN_PROGRAM_ADDRESS) {
      // Key 3 is always mint in create ATA instruction
      const mintKey = ix.accounts?.[3]?.address;

      if (mintKey === withdrawOpts.withdrawBank.mint || mintKey === depositOpts.depositBank.mint) {
        return false;
      }
    }

    return true;
  });

  setupIxs.push(...jupiterSetupInstructions);

  const additionalTxs: SolanaTransaction[] = [];

  // If ATAs, additional instructions, or refreshes are needed, add them
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
    actionTxIndex: transactions.length - 1,
    quoteResponse: swapQuote,
    mustBeAtomicBundle: refreshIntegrationIxs.length > 0,
  };
}

async function buildSwapCollateralFlashloanTx({
  programAddress,
  marginfiAccount,
  authority,
  bankMap,
  withdrawOpts,
  depositOpts,
  swapOpts,
  bankMetadataMap,
  assetShareValueMultiplierByBank,
  luts,
  rpc,
  latestBlockhash,
  swapEngineRunner,
}: MakeSwapCollateralTxParams & { latestBlockhash: BlockhashLifetimeConstraint }) {
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
    getSetComputeUnitLimitInstruction({ units: 1_200_000 }),
    getSetComputeUnitPriceInstruction({ microLamports: 1 }),
  ];

  let swapInstructions: Instruction[] = [];
  let setupInstructions: Instruction[] = [];
  let swapLookupTables: AddressesByLookupTableAddress = {};
  let swapQuote: SwapQuoteResult | undefined;
  let sizeConstraintUsed = 0;

  // Build withdraw instruction
  const withdrawParams = {
    programAddress,
    bank: withdrawBank,
    bankMap,
    tokenProgram: withdrawTokenProgram,
    amount: actualWithdrawAmount,
    marginfiAccount,
    authority,
    withdrawAll: isFullWithdraw,
    opts: {
      createAtas: false,
      wrapAndUnwrapSol: false,
    },
  };
  let withdrawIxs: Instruction[];

  switch (withdrawBank.config.assetTag) {
    case AssetTag.KAMINO: {
      const reserve = bankMetadataMap[withdrawBank.address]?.kaminoStates?.reserveState;

      if (!reserve) {
        throw TransactionBuildingError.kaminoReserveNotFound(
          withdrawBank.address,
          withdrawBank.mint,
          withdrawBank.tokenSymbol
        );
      }

      // Sometimes the ctoken conversion can be off by a few basis points, this accounts for that
      const multiplier =
        assetShareValueMultiplierByBank.get(withdrawBank.address) ?? new BigNumber(1);
      const adjustedAmount = new BigNumber(actualWithdrawAmount)
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
      const driftState = bankMetadataMap[withdrawBank.address]?.driftStates;

      if (!driftState) {
        throw TransactionBuildingError.driftStateNotFound(
          withdrawBank.address,
          withdrawBank.mint,
          withdrawBank.tokenSymbol
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
      const jupLendState = bankMetadataMap[withdrawBank.address]?.jupLendStates;

      if (!jupLendState) {
        throw TransactionBuildingError.jupLendStateNotFound(
          withdrawBank.address,
          withdrawBank.mint,
          withdrawBank.tokenSymbol
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

  // Deferred-swap: when a swap is needed the deposit is seeded with a placeholder amount
  // (its byte/account footprint is amount-independent) and byte-patched to the real swap
  // output after the engine runs. Same-mint deposits the exact withdrawn amount.
  const swapNeeded = depositBank.mint !== withdrawBank.mint;

  // Build deposit instruction
  const depositParams = {
    programAddress,
    bank: depositBank,
    tokenProgram: depositTokenProgram,
    amount: swapNeeded ? 0 : actualWithdrawAmount,
    accountAddress: marginfiAccount.address,
    authority,
    group: marginfiAccount.group,
    opts: {
      wrapAndUnwrapSol: false,
    },
  };
  let depositIxs: Instruction[];

  switch (depositBank.config.assetTag) {
    case AssetTag.KAMINO: {
      const reserve = bankMetadataMap[depositBank.address]?.kaminoStates?.reserveState;

      if (!reserve) {
        throw TransactionBuildingError.kaminoReserveNotFound(
          depositBank.address,
          depositBank.mint,
          depositBank.tokenSymbol
        );
      }

      depositIxs = await makeKaminoDepositIx({ ...depositParams, reserve });
      break;
    }
    case AssetTag.DRIFT: {
      const driftState = bankMetadataMap[depositBank.address]?.driftStates;

      if (!driftState) {
        throw TransactionBuildingError.driftStateNotFound(
          depositBank.address,
          depositBank.mint,
          depositBank.tokenSymbol
        );
      }

      depositIxs = await makeDriftDepositIx({
        ...depositParams,
        driftMarketIndex: driftState.spotMarketState.marketIndex,
        driftOracle: driftState.spotMarketState.oracle,
      });
      break;
    }
    case AssetTag.JUPLEND: {
      depositIxs = await makeJuplendDepositIx(depositParams);
      break;
    }
    default: {
      depositIxs = await makeDepositIx(depositParams);
      break;
    }
  }

  if (swapNeeded) {
    const [destinationTokenAccount] = await findAssociatedTokenPda({
      mint: depositBank.mint,
      owner: authority.address,
      tokenProgram: depositTokenProgram,
    });

    const swapConstraints = await computeFlashloanSwapConstraints({
      programAddress,
      marginfiAccount,
      bankMap,
      bankMetadataMap,
      luts: luts ?? {},
      primaryIx: { type: "withdraw", bank: withdrawBank, tokenProgram: withdrawTokenProgram },
      secondaryIx: { type: "deposit", bank: depositBank, tokenProgram: depositTokenProgram },
    });
    sizeConstraintUsed = swapConstraints.sizeConstraint;

    const runEngine = swapEngineRunner ?? runSwapEngine;
    const engineResult = await runEngine({
      inputMint: withdrawBank.mint,
      outputMint: depositBank.mint,
      amountNative: Number(uiToNative(actualWithdrawAmount, withdrawBank.mintDecimals)),
      inputDecimals: withdrawBank.mintDecimals,
      outputDecimals: depositBank.mintDecimals,
      ...swapEngineQuoteFieldsFromOpts(swapOpts),
      taker: authority.address,
      destinationTokenAccount,
      rpc,
      footprint: {
        instructions: [...cuRequestIxs, ...withdrawIxs, ...depositIxs],
        luts: luts ?? {},
        payer: authority.address,
        sizeConstraint: swapConstraints.sizeConstraint,
        maxSwapTotalAccounts: swapConstraints.maxSwapTotalAccounts,
      },
      providers: swapEngineProvidersFromOpts(swapOpts),
    });

    // Patch the seeded deposit to the real (minimum guaranteed) swap output.
    const depositIxIndex = depositIxs.findIndex(isDepositIx);
    if (depositIxIndex < 0) {
      throw new Error("swap-collateral: could not locate deposit instruction for amount patching");
    }
    depositIxs[depositIxIndex] = patchDepositAmount(
      depositIxs[depositIxIndex],
      engineResult.outputAmountNative
    );

    swapInstructions = engineResult.swapInstructions;
    setupInstructions = engineResult.setupInstructions;
    swapLookupTables = engineResult.swapLuts;
    swapQuote = engineResult.quoteResponse;
  }

  const flashloanLuts = { ...luts, ...swapLookupTables };

  const allNonFlIxs = [...cuRequestIxs, ...withdrawIxs, ...swapInstructions, ...depositIxs];

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

  // Wallets add a priority fee ix by default breaking the flashloan tx so we need to add a placeholder priority fee ix
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
        params.rpc,
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
        (b) => b.active && b.bankPk === bridgeBank.address && b.assetShares.gt(0)
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
        programAddress: params.programAddress,
        banksMap: params.bankMap,
        assetShareValueMultiplierByBank: params.assetShareValueMultiplierByBank,
        feePayer: params.authority,
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
