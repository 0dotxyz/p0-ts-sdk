import {
  getTransactionMessageSizeLimit,
  type AddressesByLookupTableAddress,
  type BlockhashLifetimeConstraint,
  type Instruction,
} from "@solana/kit";
import {
  getSetComputeUnitLimitInstruction,
  getSetComputeUnitPriceInstruction,
} from "@solana-program/compute-budget";
import { findAssociatedTokenPda } from "@solana-program/token";
import { BigNumber } from "bignumber.js";

import {
  runSwapEngine,
  swapEngineProvidersFromOpts,
  swapEngineQuoteFieldsFromOpts,
} from "../services/swap-engine";
import { MakeSwapCollateralTxParams, SwapFlowTxResult, SwapQuoteResult } from "../types";
import {
  exceedsCostlyPositionLimit,
  isWholePosition,
  computeFlashloanSwapConstraints,
  compileFlashloanPrecheck,
  patchDepositAmount,
  filterRouteSetupIxs,
} from "../utils";

import { makeCreateMissingAtaIxs } from "./account-lifecycle";
import { BridgedTxResult, BridgeOpts, makeBridgedTx } from "./bridge-swap";
import { makeDepositIx } from "./deposit";
import { makeFlashLoanTx } from "./flash-loan";
import { makeWithdrawIx } from "./withdraw";

import { MAX_ACCOUNT_LOCKS } from "~/constants";
import { TransactionBuildingError } from "~/errors";
import { AssetTag } from "~/services/bank";
import { makeRefreshIntegrationBanksIxs } from "~/services/price";
import {
  getTotalAccountKeys,
  getTxSize,
  makePreludeTxs,
  SolanaTransaction,
  withLookupTables,
} from "~/services/transaction";
import { nativeToUi, uiToNative } from "~/utils";

/**
 * Swaps one collateral position into another in one flashloan: withdraws `withdrawOpts`, swaps it
 * into the deposit token (unless the two banks share a mint) and deposits the swap's guaranteed
 * output, without the account's health dipping in between. Prelude transactions create missing
 * ATAs and refresh integration banks.
 * @throws TransactionBuildingError (INVALID_AMOUNT) if `withdrawAmount` isn't positive
 * @throws TransactionBuildingError (COSTLY_POSITION_LIMIT_EXCEEDED) if the deposit would open an
 * integration or staked position beyond the account's limit
 * @throws TransactionBuildingError (SWAP_QUOTE_FAILED) if no provider can quote the swap
 * @throws TransactionBuildingError (SWAP_SIZE_EXCEEDED_POSITION_SWAP) if the flashloan doesn't fit
 * one transaction
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
export async function makeSwapCollateralTx(
  params: MakeSwapCollateralTxParams
): Promise<SwapFlowTxResult> {
  const {
    marginfiAccount,
    authority,
    rpc,
    bankMap,
    withdrawOpts,
    depositOpts,
    bankMetadataMap,
    txFormat,
  } = params;

  const { value: latestBlockhash } = await rpc
    .getLatestBlockhash({ commitment: "confirmed" })
    .send();

  const setupIxs = await makeCreateMissingAtaIxs({
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

  setupIxs.push(
    ...filterRouteSetupIxs(setupInstructions, [
      withdrawOpts.withdrawBank.mint,
      depositOpts.depositBank.mint,
    ])
  );

  const additionalTxs = makePreludeTxs(setupIxs, refreshIntegrationIxs, {
    latestBlockhash,
    feePayer: authority,
    txFormat,
  });

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
  txFormat,
  rpc,
  latestBlockhash,
  swapEngineRunner,
}: MakeSwapCollateralTxParams & { latestBlockhash: BlockhashLifetimeConstraint }): Promise<{
  flashloanTx: SolanaTransaction;
  setupInstructions: Instruction[];
  swapQuote: SwapQuoteResult | undefined;
}> {
  const {
    withdrawBank,
    tokenProgram: withdrawTokenProgram,
    totalPositionAmount,
    withdrawAmount,
  } = withdrawOpts;
  const { depositBank, tokenProgram: depositTokenProgram } = depositOpts;

  if (withdrawAmount !== undefined && withdrawAmount <= 0) {
    throw TransactionBuildingError.invalidAmount(withdrawAmount);
  }

  const actualWithdrawAmount = Math.min(withdrawAmount ?? totalPositionAmount, totalPositionAmount);
  const isFullWithdraw = isWholePosition(
    { amount: totalPositionAmount, isLending: true },
    actualWithdrawAmount,
    withdrawBank.mintDecimals
  );
  // A full withdraw closes its balance before the deposit opens one, freeing that position.
  const balancesAtDeposit = isFullWithdraw
    ? marginfiAccount.balances.filter((balance) => balance.bankPk !== withdrawBank.address)
    : marginfiAccount.balances;
  if (exceedsCostlyPositionLimit(balancesAtDeposit, bankMap, depositBank)) {
    throw TransactionBuildingError.costlyPositionLimitExceeded(depositBank.address);
  }

  const cuRequestIxs = [
    getSetComputeUnitLimitInstruction({ units: 1_200_000 }),
    getSetComputeUnitPriceInstruction({ microLamports: 1 }),
  ];

  let swapInstructions: Instruction[] = [];
  let setupInstructions: Instruction[] = [];
  let swapLookupTables: AddressesByLookupTableAddress = {};
  let swapQuote: SwapQuoteResult | undefined;
  let sizeConstraintUsed = 0;

  // Kamino withdraws are sized in cTokens; the conversion can be off by a few basis points, so pad
  // it to be sure the withdraw covers the swap input.
  const kaminoMultiplier =
    assetShareValueMultiplierByBank.get(withdrawBank.address) ?? new BigNumber(1);
  const withdrawIxs = await makeWithdrawIx({
    programAddress,
    bank: withdrawBank,
    bankMap,
    tokenProgram: withdrawTokenProgram,
    amount:
      withdrawBank.config.assetTag === AssetTag.KAMINO
        ? {
            value: new BigNumber(actualWithdrawAmount)
              .div(kaminoMultiplier)
              .times(1.0001)
              .toNumber(),
            type: "cToken",
          }
        : actualWithdrawAmount,
    marginfiAccount,
    authority,
    bankMetadataMap,
    withdrawAll: isFullWithdraw,
    opts: {
      createAta: false,
      unwrapSol: false,
    },
  });

  // Deferred-swap: when a swap is needed the deposit is seeded with a placeholder amount
  // (its byte/account footprint is amount-independent) and byte-patched to the real swap
  // output after the engine runs. Same-mint deposits the exact withdrawn amount.
  const swapNeeded = depositBank.mint !== withdrawBank.mint;

  const depositIxs = await makeDepositIx({
    programAddress,
    bank: depositBank,
    tokenProgram: depositTokenProgram,
    amount: swapNeeded ? 0 : actualWithdrawAmount,
    marginfiAccount,
    authority,
    bankMetadataMap,
    opts: {
      wrapSol: false,
    },
  });

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
      txFormat,
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
        txFormat,
        payer: authority.address,
        sizeConstraint: swapConstraints.sizeConstraint,
        maxSwapTotalAccounts: swapConstraints.maxSwapTotalAccounts,
      },
      providers: swapEngineProvidersFromOpts(swapOpts),
    });

    // Without wSOL wrapping the deposit is a single instruction
    depositIxs[0] = patchDepositAmount(depositIxs[0], engineResult.outputAmountNative);

    swapInstructions = engineResult.swapInstructions;
    setupInstructions = engineResult.setupInstructions;
    swapLookupTables = engineResult.swapLuts;
    swapQuote = engineResult.quoteResponse;
  }

  const flashloanFormat = withLookupTables(txFormat, swapLookupTables);

  const allNonFlIxs = [...cuRequestIxs, ...withdrawIxs, ...swapInstructions, ...depositIxs];

  if (swapInstructions.length > 0) {
    compileFlashloanPrecheck({
      allIxs: allNonFlIxs,
      payer: authority.address,
      txFormat: flashloanFormat,
      sizeConstraint: sizeConstraintUsed,
      swapIxCount: swapInstructions.length,
      swapLutCount: Object.keys(swapLookupTables).length,
    });
  }

  const flashloanTx = await makeFlashLoanTx({
    programAddress,
    marginfiAccount,
    authority,
    bankMap,
    txFormat: flashloanFormat,
    latestBlockhash,
    ixs: allNonFlIxs,
  });

  const txSize = getTxSize(flashloanTx.message);
  const totalKeys = getTotalAccountKeys(flashloanTx.message);

  if (
    txSize > getTransactionMessageSizeLimit(flashloanTx.message) ||
    totalKeys > MAX_ACCOUNT_LOCKS
  ) {
    throw TransactionBuildingError.swapSizeExceededPositionSwap(
      txSize,
      totalKeys,
      swapOpts.swapConfig?.provider
    );
  }

  return { flashloanTx, setupInstructions, swapQuote };
}

// ----------------------------------------------------------------------------
// Bridged (double-hop) fallback
// ----------------------------------------------------------------------------

export interface MakeBridgedSwapCollateralTxParams extends MakeSwapCollateralTxParams {
  bridgeOpts?: BridgeOpts;
}

// The close leg's swap input stays this far (native units) under the open leg's bridge min-out:
// share rounding on the deposit→withdraw round trip can come back a unit short, and the UI-amount
// round trip can floor another
const CLOSE_LEG_HEADROOM_NATIVE = 10;

/**
 * {@link makeSwapCollateralTx}, or when the swap `A → C` doesn't fit one transaction or has no
 * route, `A → bridge` then `bridge → C` through a liquid bridge collateral as one atomic bundle
 * (see {@link makeBridgedTx}).
 */
export async function makeBridgedSwapCollateralTx(
  params: MakeBridgedSwapCollateralTxParams
): Promise<BridgedTxResult> {
  const { withdrawOpts, depositOpts } = params;
  return makeBridgedTx({
    ...params,
    side: "deposit",
    sourceMint: withdrawOpts.withdrawBank.mint,
    destinationMint: depositOpts.depositBank.mint,
    buildWithoutBridge: () => makeSwapCollateralTx(params),
    buildOpenBridgeLeg: ({ bridgeBank, bridgeTokenProgram, context }) =>
      makeSwapCollateralTx({
        ...context,
        withdrawOpts,
        depositOpts: { depositBank: bridgeBank, tokenProgram: bridgeTokenProgram },
      }),
    buildCloseBridgeLeg: async ({ bridgeBank, bridgeTokenProgram, context, openLegQuote }) => {
      // Spend just under the open leg's guaranteed bridge output, so its slippage can't fail this leg
      const bridgeMinOut = Number(openLegQuote.otherAmountThreshold);
      const amountNative = bridgeMinOut - CLOSE_LEG_HEADROOM_NATIVE;
      if (amountNative <= 0) return null;
      const amount = nativeToUi(amountNative, bridgeBank.mintDecimals);
      // Withdraw all of the bridge so no dust position stays behind, unless the account already
      // held it: then a withdraw-all would sweep the user's own position into the swap
      const heldBridge = params.marginfiAccount.balances.some(
        (b) => b.active && b.bankPk === bridgeBank.address && b.assetShares.gt(0)
      );
      return makeSwapCollateralTx({
        ...context,
        withdrawOpts: {
          totalPositionAmount: heldBridge
            ? nativeToUi(bridgeMinOut, bridgeBank.mintDecimals)
            : amount,
          withdrawAmount: amount,
          withdrawBank: bridgeBank,
          tokenProgram: bridgeTokenProgram,
        },
        depositOpts,
      });
    },
  });
}
