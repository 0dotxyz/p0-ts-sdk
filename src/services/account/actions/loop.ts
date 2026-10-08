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
  LoopFlashloanDescriptor,
  MakeLoopTxParams,
  SwapFlowTxResult,
  SwapQuoteResult,
} from "../types";
import {
  computeFlashloanSwapConstraints,
  compileFlashloanPrecheck,
  exceedsCostlyPositionLimit,
  patchDepositAmount,
  resolvePinnedSwapRoute,
} from "../utils";

import { makeCreateMissingAtaIxs } from "./account-lifecycle";
import { makeBorrowIx } from "./borrow";
import { BridgedTxResult, BridgeOpts, makeBridgedTx } from "./bridge-swap";
import { makeDepositIx } from "./deposit";
import { makeFlashLoanTx } from "./flash-loan";
import { makeSwapDebtTx } from "./swap-debt";

import { MAX_ACCOUNT_LOCKS, WSOL_MINT } from "~/constants";
import { TransactionBuildingError } from "~/errors";
import { BankType } from "~/services/bank";
import { makeRefreshIntegrationBanksIxs, OraclePrice } from "~/services/price";
import {
  getTotalAccountKeys,
  getTxSize,
  makePreludeTxs,
  makeWrapSolIxs,
  SolanaTransaction,
  TransactionFormat,
  withLookupTables,
} from "~/services/transaction";
import { nativeToUi, uiToNative } from "~/utils";

/**
 * Loops `depositOpts.depositBank` in one flashloan: borrows `borrowOpts.borrowAmount`, swaps it
 * into the deposit token (unless the two banks share a mint) and deposits the swap's guaranteed
 * output, plus `depositOpts.inputDepositAmount` from the wallet in `"DEPOSIT"` mode. Prelude
 * transactions create missing ATAs, wrap SOL for a SOL principal, and refresh integration banks.
 * @throws TransactionBuildingError (COSTLY_POSITION_LIMIT_EXCEEDED) if the deposit would open an
 * integration or staked position beyond the account's limit
 * @throws TransactionBuildingError (SWAP_SIZE_EXCEEDED_LOOP) if the flashloan doesn't fit one
 * transaction
 */
export async function makeLoopTx(params: MakeLoopTxParams): Promise<SwapFlowTxResult> {
  const { authority, depositOpts, borrowOpts, txFormat, rpc, additionalIxs = [] } = params;
  if (
    exceedsCostlyPositionLimit(
      params.marginfiAccount.balances,
      params.bankMap,
      depositOpts.depositBank
    )
  ) {
    throw TransactionBuildingError.costlyPositionLimitExceeded(depositOpts.depositBank.address);
  }

  const { value: latestBlockhash } = await rpc
    .getLatestBlockhash({ commitment: "confirmed" })
    .send();

  const setupIxs = await makeCreateMissingAtaIxs({
    rpc,
    authority,
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

  // depositBank is excluded from the jup/drift updates (deposit ix updates them via CPI);
  // kamino has no cpi so borrow and deposit banks are included in the refresh
  const refreshIntegrationIxs = await makeRefreshIntegrationBanksIxs(
    params.marginfiAccount,
    params.bankMap,
    [depositOpts.depositBank.address],
    params.bankMetadataMap,
    [borrowOpts.borrowBank.address, depositOpts.depositBank.address]
  );

  const { flashloanTx, setupInstructions, swapQuote } = await buildLoopFlashloanTx({
    ...params,
    latestBlockhash,
  });

  // The route's own setup minus its compute budget and the ATAs created above
  const routeSetupIxs = setupInstructions.filter((ix) => {
    if (ix.programAddress === COMPUTE_BUDGET_PROGRAM_ADDRESS) {
      return false;
    }
    if (ix.programAddress === ASSOCIATED_TOKEN_PROGRAM_ADDRESS) {
      // Account 3 of an ATA create is the mint
      const mintKey = ix.accounts?.[3]?.address;
      if (mintKey === depositOpts.depositBank.mint || mintKey === borrowOpts.borrowBank.mint) {
        return false;
      }
    }
    return true;
  });

  setupIxs.push(...routeSetupIxs);

  // Only a "DEPOSIT" loop deposits the principal, so only it wraps SOL for one
  if (
    depositOpts.loopMode === "DEPOSIT" &&
    depositOpts.depositBank.mint === WSOL_MINT &&
    depositOpts.inputDepositAmount
  ) {
    setupIxs.push(
      ...(await makeWrapSolIxs(authority, new BigNumber(depositOpts.inputDepositAmount)))
    );
  }

  const additionalTxs = makePreludeTxs([...additionalIxs, ...setupIxs], refreshIntegrationIxs, {
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

type LoopParams = MakeLoopTxParams & { latestBlockhash: BlockhashLifetimeConstraint };

// Builds the flashloan without the swap, lets the swap engine pick a route that fits the remaining
// budget, then splices the route in and patches the deposit to its guaranteed output
async function buildLoopFlashloanTx(params: LoopParams): Promise<{
  flashloanTx: SolanaTransaction;
  setupInstructions: Instruction[];
  swapQuote: SwapQuoteResult | undefined;
}> {
  const { depositOpts } = params;

  const { descriptor, swapNeeded } = await buildLoopNonSwapIxs(params);

  if (!swapNeeded) {
    const flashloanTx = await finalizeLoopFlashloanTx({
      params,
      innerIxs: descriptor.innerIxs,
      txFormat: descriptor.txFormat,
      swapIxCount: 0,
      swapLutCount: 0,
      sizeConstraint: descriptor.sizeConstraint,
    });

    return { flashloanTx, setupInstructions: [], swapQuote: undefined };
  }

  const engineResult = await runLoopSwapEngine(descriptor, params);

  const finalIxs = [...descriptor.innerIxs];
  finalIxs.splice(descriptor.swapSlotIndex, 0, ...engineResult.swapInstructions);

  const principalNative =
    depositOpts.loopMode === "DEPOSIT"
      ? uiToNative(depositOpts.inputDepositAmount, depositOpts.depositBank.mintDecimals)
      : 0n;
  const finalDepositNative = engineResult.outputAmountNative + principalNative;

  const depositIxPosition = descriptor.depositIxIndex + engineResult.swapInstructions.length;
  finalIxs[depositIxPosition] = patchDepositAmount(finalIxs[depositIxPosition], finalDepositNative);

  const flashloanTx = await finalizeLoopFlashloanTx({
    params,
    innerIxs: finalIxs,
    txFormat: withLookupTables(descriptor.txFormat, engineResult.swapLuts),
    swapIxCount: engineResult.swapInstructions.length,
    swapLutCount: Object.keys(engineResult.swapLuts).length,
    sizeConstraint: descriptor.sizeConstraint,
  });

  return {
    flashloanTx,
    setupInstructions: engineResult.setupInstructions,
    swapQuote: engineResult.quoteResponse,
  };
}

// With a swap, the deposit is seeded with a no-slippage estimate of the swap output; the real
// amount is patched in once the route is known
async function buildLoopNonSwapIxs(params: LoopParams): Promise<{
  descriptor: LoopFlashloanDescriptor;
  swapNeeded: boolean;
}> {
  const {
    programAddress,
    marginfiAccount,
    authority,
    bankMap,
    borrowOpts,
    depositOpts,
    bankMetadataMap,
    txFormat,
  } = params;

  const cuRequestIxs = [
    getSetComputeUnitLimitInstruction({ units: 1_200_000 }),
    getSetComputeUnitPriceInstruction({ microLamports: 1 }),
  ];

  const swapNeeded = depositOpts.depositBank.mint !== borrowOpts.borrowBank.mint;

  const [destinationTokenAccount] = await findAssociatedTokenPda({
    mint: depositOpts.depositBank.mint,
    owner: authority.address,
    tokenProgram: depositOpts.tokenProgram,
  });

  const principalUi = depositOpts.loopMode === "DEPOSIT" ? depositOpts.inputDepositAmount : 0;

  let depositAmountUi: number;
  let sizeConstraint = 0;
  let maxSwapTotalAccounts = 0;

  if (!swapNeeded) {
    depositAmountUi = borrowOpts.borrowAmount + principalUi;
  } else {
    const swapConstraints = await computeFlashloanSwapConstraints({
      programAddress,
      marginfiAccount,
      bankMap,
      bankMetadataMap,
      txFormat,
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
    });
    sizeConstraint = swapConstraints.sizeConstraint;
    maxSwapTotalAccounts = swapConstraints.maxSwapTotalAccounts;

    const estimateUi = (borrowOpts.borrowAmount * borrowOpts.marketPrice) / depositOpts.marketPrice;
    depositAmountUi = estimateUi + principalUi;
  }

  const borrowIxs = await makeBorrowIx({
    programAddress,
    bank: borrowOpts.borrowBank,
    bankMap,
    tokenProgram: borrowOpts.tokenProgram,
    amount: borrowOpts.borrowAmount,
    marginfiAccount,
    authority,
    opts: {
      createAta: false,
      unwrapSol: false,
    },
  });

  const depositIxs = await makeDepositIx({
    programAddress,
    bank: depositOpts.depositBank,
    tokenProgram: depositOpts.tokenProgram,
    amount: depositAmountUi,
    marginfiAccount,
    authority,
    bankMetadataMap,
    opts: {
      wrapSol: false,
    },
  });

  // [compute budget, borrow, <swap slot>, deposit]: without wSOL wrapping the deposit is one
  // instruction, right after the swap slot
  const swapSlotIndex = cuRequestIxs.length + borrowIxs.length;
  const innerIxs = [...cuRequestIxs, ...borrowIxs, ...depositIxs];

  const descriptor: LoopFlashloanDescriptor = {
    innerIxs,
    swapSlotIndex,
    depositIxIndex: swapSlotIndex,
    inputMint: borrowOpts.borrowBank.mint,
    outputMint: depositOpts.depositBank.mint,
    inputDecimals: borrowOpts.borrowBank.mintDecimals,
    outputDecimals: depositOpts.depositBank.mintDecimals,
    inAmountNative: Number(uiToNative(borrowOpts.borrowAmount, borrowOpts.borrowBank.mintDecimals)),
    destinationTokenAccount,
    sizeConstraint,
    maxSwapTotalAccounts,
    txFormat,
  };

  return { descriptor, swapNeeded };
}

// ExactIn on the borrow amount, sized against the flashloan's remaining budget
async function runLoopSwapEngine(
  descriptor: LoopFlashloanDescriptor,
  params: LoopParams
): Promise<{
  swapInstructions: Instruction[];
  setupInstructions: Instruction[];
  swapLuts: AddressesByLookupTableAddress;
  quoteResponse: SwapQuoteResult;
  outputAmountNative: bigint;
}> {
  const { rpc, swapOpts, authority, swapEngineRunner } = params;

  if (swapOpts.swapIxs) {
    const pinned = resolvePinnedSwapRoute(swapOpts.swapIxs, descriptor.inAmountNative);
    return {
      swapInstructions: pinned.swapInstructions,
      setupInstructions: pinned.setupInstructions,
      swapLuts: pinned.lookupTables,
      quoteResponse: pinned.quoteResponse,
      outputAmountNative: pinned.outputAmountNative,
    };
  }

  const runEngine = swapEngineRunner ?? runSwapEngine;
  return runEngine({
    inputMint: descriptor.inputMint,
    outputMint: descriptor.outputMint,
    amountNative: descriptor.inAmountNative,
    inputDecimals: descriptor.inputDecimals,
    outputDecimals: descriptor.outputDecimals,
    ...swapEngineQuoteFieldsFromOpts(swapOpts),
    taker: authority.address,
    destinationTokenAccount: descriptor.destinationTokenAccount,
    rpc,
    footprint: {
      instructions: descriptor.innerIxs,
      txFormat: descriptor.txFormat,
      payer: authority.address,
      sizeConstraint: descriptor.sizeConstraint,
      maxSwapTotalAccounts: descriptor.maxSwapTotalAccounts,
    },
    providers: swapEngineProvidersFromOpts(swapOpts),
  });
}

async function finalizeLoopFlashloanTx({
  params,
  innerIxs,
  txFormat,
  swapIxCount,
  swapLutCount,
  sizeConstraint,
}: {
  params: LoopParams;
  innerIxs: Instruction[];
  txFormat: TransactionFormat;
  swapIxCount: number;
  swapLutCount: number;
  sizeConstraint: number;
}) {
  const { programAddress, marginfiAccount, authority, bankMap, swapOpts, latestBlockhash } = params;

  if (swapIxCount > 0) {
    compileFlashloanPrecheck({
      allIxs: innerIxs,
      payer: authority.address,
      txFormat,
      sizeConstraint,
      swapIxCount,
      swapLutCount,
    });
  }

  const flashloanTx = await makeFlashLoanTx({
    programAddress,
    marginfiAccount,
    authority,
    bankMap,
    txFormat,
    latestBlockhash,
    ixs: innerIxs,
  });

  const txSize = getTxSize(flashloanTx.message);
  const totalKeys = getTotalAccountKeys(flashloanTx.message);

  if (
    txSize > getTransactionMessageSizeLimit(flashloanTx.message) ||
    totalKeys > MAX_ACCOUNT_LOCKS
  ) {
    throw TransactionBuildingError.swapSizeExceededLoop(
      txSize,
      totalKeys,
      swapOpts.swapConfig?.provider
    );
  }

  return flashloanTx;
}

// ----------------------------------------------------------------------------
// Bridged (double-hop) fallback
// ----------------------------------------------------------------------------

export interface MakeBridgedLoopTxParams extends MakeLoopTxParams {
  bridgeOpts?: BridgeOpts;
  /** Prices the bridge legs (by bank address). */
  oraclePrices: Map<string, OraclePrice>;
}

/**
 * {@link makeLoopTx}, or when its borrow → deposit swap doesn't fit one transaction or has no
 * route, loops the deposit borrowing a value-equivalent amount of a bridge, then swaps that bridge
 * debt into the borrow token, as one atomic bundle (see {@link makeBridgedTx}).
 *
 * Intended for existing accounts — a fresh account's loop has a minimal footprint and fits the
 * direct path, so callers creating the account in the same flow should call {@link makeLoopTx}
 * directly.
 */
export async function makeBridgedLoopTx(params: MakeBridgedLoopTxParams): Promise<BridgedTxResult> {
  const { depositOpts, borrowOpts } = params;
  // The legs are priced by oracle (0 when missing): the caller's market prices only cover the pair
  const priceOf = (bank: BankType) =>
    params.oraclePrices.get(bank.address)?.priceRealtime.price.toNumber() ?? 0;
  return makeBridgedTx({
    ...params,
    side: "borrow",
    sourceMint: depositOpts.depositBank.mint,
    destinationMint: borrowOpts.borrowBank.mint,
    buildWithoutBridge: () => makeLoopTx(params),
    buildOpenBridgeLeg: async ({ bridgeBank, bridgeTokenProgram, context }) => {
      const borrowPrice = priceOf(borrowOpts.borrowBank);
      const bridgePrice = priceOf(bridgeBank);
      if (borrowPrice <= 0 || bridgePrice <= 0) return null;
      const bridgeAmount = (borrowOpts.borrowAmount * borrowPrice) / bridgePrice;
      if (bridgeAmount <= 0) return null;
      return makeLoopTx({
        ...context,
        depositOpts: { ...depositOpts, marketPrice: priceOf(depositOpts.depositBank) },
        borrowOpts: {
          borrowAmount: bridgeAmount,
          borrowBank: bridgeBank,
          tokenProgram: bridgeTokenProgram,
          marketPrice: bridgePrice,
        },
      });
    },
    buildCloseBridgeLeg: ({ bridgeBank, bridgeTokenProgram, context, openLegQuote }) => {
      // Repay exactly the bridge the open leg borrowed (its swap input), so repay-all clears it
      const bridgeDebt = nativeToUi(openLegQuote.inAmount, bridgeBank.mintDecimals);
      return makeSwapDebtTx({
        ...context,
        repayOpts: {
          totalPositionAmount: bridgeDebt,
          repayAmount: bridgeDebt,
          repayBank: bridgeBank,
          tokenProgram: bridgeTokenProgram,
          marketPrice: priceOf(bridgeBank),
        },
        borrowOpts: {
          borrowBank: borrowOpts.borrowBank,
          tokenProgram: borrowOpts.tokenProgram,
          marketPrice: priceOf(borrowOpts.borrowBank),
        },
      });
    },
  });
}
