import {
  assertAccountExists,
  fetchEncodedAccount,
  getTransactionMessageSizeLimit,
} from "@solana/kit";
import {
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstruction,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";
import { BigNumber } from "bignumber.js";

import type { MakeVaultDepositWithSwapTxParams } from "../types";
import { fetchGammaLpVault } from "../utils";

import { MAX_ACCOUNT_LOCKS, MAX_TX_SIZE, TOKEN_2022_PROGRAM_ID, WSOL_MINT } from "~/constants";
import {
  runSwapEngine,
  swapEngineProvidersFromOpts,
  swapEngineQuoteFieldsFromOpts,
  type SwapQuoteResult,
} from "~/services/account";
import {
  getTotalAccountKeys,
  getTxSize,
  makeTransactionMessage,
  makeWrapSolIxs,
  SolanaTransaction,
  TransactionType,
  withLookupTables,
} from "~/services/transaction";
import { nativeToUi, uiToNative } from "~/utils";
import { makeGammaDepositIx } from "~/vendor/gamma/instructions";

/**
 * Zap-deposits into a Gamma LP vault in one transaction: swaps `inputAmount` (UI units of
 * `inputMint`) into the vault's asset mint and deposits the swap's minimum guaranteed output, so
 * the deposit never exceeds what the swap yields (any surplus stays in the wallet). Native SOL is
 * wrapped first. The authority pays, signs and takes the swap; `latestBlockhash` is fetched when
 * omitted.
 * @throws if `lpVault` or its asset mint doesn't exist, the swap has no route, or the transaction
 * exceeds the size or account-lock limits
 */
export async function makeVaultDepositWithSwapTx(
  params: MakeVaultDepositWithSwapTxParams
): Promise<{
  transaction: SolanaTransaction;
  quoteResponse: SwapQuoteResult;
  /** Minimum vault-asset amount received (UI units): what gets deposited. */
  destinationAmount: number;
}> {
  const {
    rpc,
    authority,
    lpVault,
    inputMint,
    inputAmount,
    inputDecimals,
    swapOpts,
    swapEngineRunner,
    txFormat,
    latestBlockhash,
  } = params;

  const vault = await fetchGammaLpVault(rpc, lpVault);
  const assetMintAccount = await fetchEncodedAccount(rpc, vault.assetsMint);
  assertAccountExists(assetMintAccount);
  const tokenProgram =
    params.tokenProgram ??
    (assetMintAccount.programAddress === TOKEN_2022_PROGRAM_ID
      ? TOKEN_2022_PROGRAM_ID
      : TOKEN_PROGRAM_ADDRESS);
  // Classic and Token-2022 mints share the decimals offset.
  const assetDecimals = assetMintAccount.data[44];

  const [[userAssetAta], [userShareAta]] = await Promise.all(
    [vault.assetsMint, vault.sharesMint].map((mint) =>
      findAssociatedTokenPda({ mint, owner: authority.address, tokenProgram })
    )
  );
  // The deposit instruction doesn't create the share ATA a first-time depositor lacks.
  const createShareAtaIx = getCreateAssociatedTokenIdempotentInstruction({
    payer: authority,
    ata: userShareAta,
    owner: authority.address,
    mint: vault.sharesMint,
    tokenProgram,
  });
  const depositAccounts = {
    user: authority,
    lpVault,
    assetsAccount: vault.assetsAccount,
    assetsMint: vault.assetsMint,
    sharesMint: vault.sharesMint,
    tokenProgram,
  };
  // The engine builds swaps without wrapping, so native SOL is wrapped up front (and counted in the
  // footprint the engine fits its route around).
  const wrapIxs = inputMint === WSOL_MINT ? await makeWrapSolIxs(authority, new BigNumber(inputAmount)) : [];

  const runEngine = swapEngineRunner ?? runSwapEngine;
  const engineResult = await runEngine({
    inputMint,
    outputMint: vault.assetsMint,
    amountNative: Number(uiToNative(inputAmount, inputDecimals)),
    inputDecimals,
    outputDecimals: assetDecimals,
    ...swapEngineQuoteFieldsFromOpts(swapOpts),
    taker: authority.address,
    destinationTokenAccount: userAssetAta,
    rpc,
    footprint: {
      // The deposit's size doesn't depend on its amount, so a zero-amount one stands in for it.
      instructions: [
        ...wrapIxs,
        createShareAtaIx,
        await makeGammaDepositIx({ ...depositAccounts, amount: 0n }),
      ],
      txFormat,
      payer: authority.address,
      // No flash loan around it: the swap may use the whole transaction.
      sizeConstraint: MAX_TX_SIZE,
      maxSwapTotalAccounts: MAX_ACCOUNT_LOCKS,
    },
    providers: swapEngineProvidersFromOpts(swapOpts),
  });

  const message = makeTransactionMessage({
    instructions: [
      ...wrapIxs,
      createShareAtaIx,
      ...engineResult.setupInstructions,
      ...engineResult.swapInstructions,
      await makeGammaDepositIx({ ...depositAccounts, amount: engineResult.outputAmountNative }),
    ],
    feePayer: authority,
    latestBlockhash:
      latestBlockhash ?? (await rpc.getLatestBlockhash({ commitment: "confirmed" }).send()).value,
    txFormat: withLookupTables(txFormat, engineResult.swapLuts),
  });

  if (
    getTxSize(message) > getTransactionMessageSizeLimit(message) ||
    getTotalAccountKeys(message) > MAX_ACCOUNT_LOCKS
  ) {
    throw new Error("vault deposit-with-swap: swap route too large to fit in one transaction");
  }

  return {
    transaction: { message, type: TransactionType.VAULT_DEPOSIT },
    quoteResponse: engineResult.quoteResponse,
    destinationAmount: nativeToUi(engineResult.outputAmountNative, assetDecimals),
  };
}
