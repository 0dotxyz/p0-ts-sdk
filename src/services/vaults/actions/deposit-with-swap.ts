import {
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import BigNumber from "bignumber.js";
import BN from "bn.js";

import type { MakeVaultDepositWithSwapTxParams } from "../types";
import { fetchGammaLpVault } from "../utils";

import { MAX_ACCOUNT_LOCKS, MAX_TX_SIZE, WSOL_MINT } from "~/constants";
import {
  runSwapEngine,
  swapEngineProvidersFromOpts,
  swapEngineQuoteFieldsFromOpts,
  type SwapEngineRunner,
  type SwapQuoteResult,
} from "~/services/account";
import {
  addTransactionMetadata,
  ExtendedV0Transaction,
  getTotalAccountKeys,
  getTxSize,
  makeWrapSolIxs,
  TransactionType,
} from "~/services/transaction";
import { nativeToUi, uiToNative } from "~/utils";
import {
  deriveGammaAta,
  deriveGammaDepositPolicy,
  deriveGammaDepositReceipt,
  deriveGammaWithdrawalPolicy,
  makeGammaDepositIx,
} from "~/vendor/gamma";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "~/vendor/spl";


/**
 * Zap-deposit into a Gamma LP vault: swap `inputMint` into the vault's asset
 * mint and deposit the swapped output — all in one transaction. Mirrors
 * `makeSwapCollateralTx`'s swap-engine composition, minus the flashloan/withdraw
 * parts (the input is wallet-funded, not borrowed).
 *
 * The deposit is sized from the swap's **minimum guaranteed output**
 * (`otherAmountThreshold`), so it can never exceed what the swap actually
 * yields; the small surplus stays in the wallet as dust.
 *
 * `inputAmount` is a UI amount of `inputMint`.
 */
export async function makeVaultDepositWithSwapTx(
  params: MakeVaultDepositWithSwapTxParams
): Promise<{
  transaction: ExtendedV0Transaction;
  quoteResponse: SwapQuoteResult;
  /** Minimum vault-asset amount received (UI units) — what gets deposited. */
  destinationAmount: number;
}> {
  const {
    user,
    lpVault,
    connection,
    inputMint,
    inputAmount,
    inputDecimals,
    swapOpts,
    swapEngineRunner,
    luts,
    blockhash: providedBlockhash,
  } = params;

  const vault = await fetchGammaLpVault(connection, lpVault);

  // One account read resolves both the token program and the asset decimals
  // (decimals is byte 44 of the SPL/Token-2022 Mint layout).
  const mintInfo = await connection.getAccountInfo(vault.assetsMint);
  if (!mintInfo) {
    throw new Error(`Vault asset mint not found: ${vault.assetsMint.toBase58()}`);
  }
  const tokenProgram =
    params.tokenProgram ??
    (mintInfo.owner.equals(TOKEN_2022_PROGRAM_ID)
      ? TOKEN_2022_PROGRAM_ID
      : TOKEN_PROGRAM_ID);
  const assetDecimals = mintInfo.data[44];

  const [withdrawalPolicy] = deriveGammaWithdrawalPolicy(lpVault);
  const [depositPolicy] = deriveGammaDepositPolicy(lpVault);
  const [depositReceipt] = deriveGammaDepositReceipt(user, lpVault);
  const userAssetAta = deriveGammaAta(vault.assetsMint, user, tokenProgram);
  const userShareAta = deriveGammaAta(vault.sharesMint, user, tokenProgram);

  // The Gamma deposit ix doesn't create the user's share ATA — create it
  // (idempotent) so a first-time depositor's deposit doesn't fail with
  // "AccountOwnedByWrongProgram" on the (System-owned) missing account.
  const createShareAtaIx = createAssociatedTokenAccountIdempotentInstruction(
    user,
    userShareAta,
    user,
    vault.sharesMint,
    tokenProgram
  );

  const depositAccounts = {
    user,
    lpVault,
    withdrawalPolicy,
    depositPolicy,
    assetsAccount: vault.assetsAccount,
    userAssetAta,
    userShareAta,
    depositReceipt,
    assetsMint: vault.assetsMint,
    sharesMint: vault.sharesMint,
    tokenProgram,
  };

  // Native SOL must be wrapped to wSOL before the swap can spend it (the engine
  // builds swaps with wrapAndUnwrapSol: false). The wrap ixs are part of the
  // non-swap footprint the engine fits its route around.
  const inputAmountBn = new BigNumber(inputAmount);
  const isNativeSol = new PublicKey(inputMint).equals(WSOL_MINT);
  const wrapIxs: TransactionInstruction[] = isNativeSol
    ? makeWrapSolIxs(user, inputAmountBn)
    : [];

  const amountNative = uiToNative(inputAmountBn, inputDecimals);

  // Placeholder deposit ix (amount-independent byte size) so the engine can
  // measure the combined tx footprint before the swap output is known.
  const placeholderDepositIx = makeGammaDepositIx(depositAccounts, new BN(0));

  const runEngine = swapEngineRunner ?? runSwapEngine;
  const engineResult = await runEngine({
    inputMint,
    outputMint: vault.assetsMint.toBase58(),
    amountNative: amountNative.toNumber(),
    inputDecimals,
    outputDecimals: assetDecimals,
    ...swapEngineQuoteFieldsFromOpts(swapOpts),
    taker: user,
    destinationTokenAccount: userAssetAta,
    connection,
    footprint: {
      instructions: [...wrapIxs, createShareAtaIx, placeholderDepositIx],
      luts: luts ?? [],
      payer: user,
      // Non-flashloan single tx: the swap may use the full tx budget.
      sizeConstraint: MAX_TX_SIZE,
      maxSwapTotalAccounts: MAX_ACCOUNT_LOCKS,
    },
    providers: swapEngineProvidersFromOpts(swapOpts),
  });

  // Deposit the minimum guaranteed swap output; the surplus is left as dust.
  const depositIx = makeGammaDepositIx(
    depositAccounts,
    engineResult.outputAmountNative
  );

  const instructions = [
    ...wrapIxs,
    createShareAtaIx,
    ...engineResult.setupInstructions,
    ...engineResult.swapInstructions,
    depositIx,
  ];
  const allLuts = [...(luts ?? []), ...engineResult.swapLuts];

  const blockhash =
    providedBlockhash ?? (await connection.getLatestBlockhash("confirmed")).blockhash;

  const message = new TransactionMessage({
    payerKey: user,
    recentBlockhash: blockhash,
    instructions,
  }).compileToV0Message(allLuts);

  const tx = new VersionedTransaction(message);

  if (getTxSize(tx) > MAX_TX_SIZE || getTotalAccountKeys(tx) > MAX_ACCOUNT_LOCKS) {
    throw new Error(
      "vault deposit-with-swap: swap route too large to fit in one transaction"
    );
  }

  return {
    transaction: addTransactionMetadata(tx, {
      signers: [],
      addressLookupTables: allLuts,
      type: TransactionType.VAULT_DEPOSIT,
    }),
    quoteResponse: engineResult.quoteResponse,
    destinationAmount: nativeToUi(engineResult.outputAmountNative, assetDecimals),
  };
}
