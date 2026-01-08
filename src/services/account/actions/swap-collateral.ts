import BigNumber from "bignumber.js";

import { AssetTag, BankType } from "~/services/bank";
import { MakeSwapCollateralTxParams, MarginfiAccountType } from "../types";
import { MarginfiProgram } from "~/types";
import {
  AddressLookupTableAccount,
  ComputeBudgetProgram,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { ReserveRaw } from "~/vendor/index";
import { calculateFlashloanTxSize } from "src/utils/tx-size-calculator";
import {
  addTransactionMetadata,
  ExtendedV0Transaction,
  getTxSize,
  InstructionsWrapper,
  MAX_TX_SIZE,
  nativeToUi,
  splitInstructionsToFitTransactions,
  TransactionType,
  uiToNative,
} from "@mrgnlabs/mrgn-common";
import { QuoteResponse } from "@jup-ag/api";
import { getJupiterSwapIxsForFlashloan } from "../utils/jupiter.utils";
import { makeSetupIx } from "./account-lifecycle";
import {
  makeRefreshKaminoBanksIxs,
  makeSmartCrankSwbFeedIx,
} from "~/services/price";
import { makeKaminoWithdrawIx, makeWithdrawIx } from "./withdraw";
import { TransactionBuildingError } from "~/errors";
import { makeDepositIx, makeKaminoDepositIx } from "./deposit";
import { makeFlashLoanTx } from "./flash-loan";

export async function makeSwapCollateralTx({
  program,
  marginfiAccount,
  connection,
  bankMap,
  oraclePrices,
  withdrawOpts,
  depositOpts,
  swapOpts,
  bankMetadataMap,
  addressLookupTableAccounts,
  overrideInferAccounts,
  crossbarUrl,
}: MakeSwapCollateralTxParams) {
  // const txSizeResult = calculateSwapCollateralTxSize({
  //   program,
  //   marginfiAccount,
  //   bankMap,
  //   withdrawOpts,
  //   depositOpts,
  //   bankMetadataMap,
  //   addressLookupTableAccounts,
  // });
  // const availableTxSize = MAX_TX_SIZE - txSizeResult.txSize;
  // const availableAccountKeys = txSizeResult.availableAccountKeys;
  // const existingAccounts = txSizeResult.existingAccounts;
  // let swapInstructions: TransactionInstruction[] = [];
  // let swapLookupTables: AddressLookupTableAccount[] = [];
  // let swapQuote: QuoteResponse | undefined = undefined;
  // let amountToDeposit: number = 0;
  // if (depositOpts.depositBank.mint.equals(withdrawOpts.withdrawBank.mint)) {
  //   // No swap needed, you just withdraw and repay the same mint
  //   amountToDeposit = withdrawOpts.totalPositionAmount;
  // } else {
  //   // Get Jupiter swap instruction using calculated available TX size
  //   const { swapInstruction, addressLookupTableAddresses, quoteResponse } =
  //     await getJupiterSwapIxsForFlashloan({
  //       quoteParams: {
  //         inputMint: withdrawOpts.withdrawBank.mint.toBase58(),
  //         outputMint: depositOpts.depositBank.mint.toBase58(),
  //         amount: uiToNative(
  //           withdrawOpts.totalPositionAmount,
  //           withdrawOpts.withdrawBank.mintDecimals
  //         ).toNumber(),
  //         dynamicSlippage: jupiterSwapOpts.jupiterOptions
  //           ? jupiterSwapOpts.jupiterOptions.slippageMode === "DYNAMIC"
  //           : true,
  //         slippageBps: jupiterSwapOpts.jupiterOptions?.slippageBps ?? undefined,
  //         swapMode: "ExactIn",
  //         platformFeeBps:
  //           jupiterSwapOpts.jupiterOptions?.platformFeeBps ?? undefined,
  //         onlyDirectRoutes:
  //           jupiterSwapOpts.jupiterOptions?.directRoutesOnly ?? false,
  //       },
  //       authority: marginfiAccount.authority,
  //       connection,
  //       availableTxSize,
  //       availableAccountKeys,
  //       existingAccounts,
  //     });
  //   amountToDeposit = nativeToUi(
  //     quoteResponse.otherAmountThreshold,
  //     depositOpts.depositBank.mintDecimals
  //   );
  //   swapInstructions = [swapInstruction];
  //   swapLookupTables = addressLookupTableAddresses;
  //   swapQuote = quoteResponse;
  // }
  // const blockhash = (await connection.getLatestBlockhash("confirmed"))
  //   .blockhash;
  // // Create atas if needed
  // const setupIxs = await makeSetupIx({
  //   connection,
  //   authority: marginfiAccount.authority,
  //   tokens: [
  //     {
  //       mint: depositOpts.depositBank.mint,
  //       tokenProgram: depositOpts.tokenProgram,
  //     },
  //     {
  //       mint: withdrawOpts.withdrawBank.mint,
  //       tokenProgram: withdrawOpts.tokenProgram,
  //     },
  //   ],
  // });
  // // Before execution compute unit limit & priority fee are replaced with a better estimation
  // const cuRequestIxs = [
  //   ComputeBudgetProgram.setComputeUnitLimit({ units: 1_200_000 }),
  // ];
  // // Will only refresh kamino banks if any banks in the portfolio are kamino
  // const kaminoRefreshIxs = makeRefreshKaminoBanksIxs(
  //   marginfiAccount,
  //   bankMap,
  //   [withdrawOpts.withdrawBank.address, depositOpts.depositBank.address],
  //   bankMetadataMap
  // );
  // let withdrawIxs: InstructionsWrapper;
  // // Logic to determine if the withdraw bank is kamino
  // if (withdrawOpts.withdrawBank.config.assetTag === AssetTag.KAMINO) {
  //   const reserve =
  //     bankMetadataMap[withdrawOpts.withdrawBank.address.toBase58()]
  //       ?.kaminoStates?.reserveState;
  //   if (!reserve) {
  //     throw TransactionBuildingError.kaminoReserveNotFound(
  //       withdrawOpts.withdrawBank.address.toBase58(),
  //       withdrawOpts.withdrawBank.mint.toBase58(),
  //       withdrawOpts.withdrawBank.tokenSymbol
  //     );
  //   }
  //   // Sometimes the ctoken conversion can be off by a few basis points, this accounts for that
  //   const adjustedAmount = new BigNumber(withdrawOpts.totalPositionAmount)
  //     .div(withdrawOpts.withdrawBank.assetShareValue)
  //     .times(1.0001)
  //     .toNumber();
  //   withdrawIxs = await makeKaminoWithdrawIx({
  //     program,
  //     bank: withdrawOpts.withdrawBank,
  //     bankMap,
  //     tokenProgram: withdrawOpts.tokenProgram,
  //     amount: adjustedAmount,
  //     marginfiAccount,
  //     authority: marginfiAccount.authority,
  //     reserve,
  //     bankMetadataMap,
  //     withdrawAll: true,
  //     opts: {
  //       createAtas: false,
  //       wrapAndUnwrapSol: false,
  //       overrideInferAccounts,
  //     },
  //   });
  // } else {
  //   withdrawIxs = await makeWithdrawIx({
  //     program,
  //     bank: withdrawOpts.withdrawBank,
  //     bankMap,
  //     tokenProgram: withdrawOpts.tokenProgram,
  //     amount: withdrawOpts.totalPositionAmount,
  //     marginfiAccount,
  //     authority: marginfiAccount.authority,
  //     withdrawAll: true,
  //     bankMetadataMap,
  //     opts: {
  //       createAtas: false,
  //       wrapAndUnwrapSol: false,
  //       overrideInferAccounts,
  //     },
  //   });
  // }
  // let depositIxs: InstructionsWrapper;
  // if (depositOpts.depositBank.config.assetTag === AssetTag.KAMINO) {
  //   const reserve =
  //     bankMetadataMap[depositOpts.depositBank.address.toBase58()]?.kaminoStates
  //       ?.reserveState;
  //   if (!reserve) {
  //     throw TransactionBuildingError.kaminoReserveNotFound(
  //       withdrawOpts.withdrawBank.address.toBase58(),
  //       withdrawOpts.withdrawBank.mint.toBase58(),
  //       withdrawOpts.withdrawBank.tokenSymbol
  //     );
  //   }
  //   depositIxs = await makeKaminoDepositIx({
  //     program,
  //     group: marginfiAccount.group,
  //     bank: depositOpts.depositBank,
  //     accountAddress: marginfiAccount.address,
  //     tokenProgram: depositOpts.tokenProgram,
  //     amount: amountToDeposit,
  //     authority: marginfiAccount.authority,
  //     reserve,
  //     opts: {
  //       wrapAndUnwrapSol: false,
  //       overrideInferAccounts,
  //     },
  //   });
  // } else {
  //   depositIxs = await makeDepositIx({
  //     program,
  //     group: marginfiAccount.group,
  //     bank: depositOpts.depositBank,
  //     accountAddress: marginfiAccount.address,
  //     tokenProgram: depositOpts.tokenProgram,
  //     amount: amountToDeposit,
  //     authority: marginfiAccount.authority,
  //     opts: {
  //       wrapAndUnwrapSol: false,
  //       overrideInferAccounts,
  //     },
  //   });
  // }
  // const { instructions: updateFeedIxs, luts: feedLuts } =
  //   await makeSmartCrankSwbFeedIx({
  //     marginfiAccount,
  //     bankMap,
  //     oraclePrices,
  //     instructions: [...withdrawIxs.instructions, ...depositIxs.instructions],
  //     program,
  //     connection,
  //     crossbarUrl,
  //   });
  // let additionalTxs: ExtendedV0Transaction[] = [];
  // let flashloanTx: ExtendedV0Transaction;
  // let txOverflown = false;
  // // if atas or refreshes are needed, add them
  // if (setupIxs.length > 0 || kaminoRefreshIxs.instructions.length > 0) {
  //   const ixs = [...setupIxs, ...kaminoRefreshIxs.instructions];
  //   const txs = splitInstructionsToFitTransactions([], ixs, {
  //     blockhash,
  //     payerKey: marginfiAccount.authority,
  //     luts: addressLookupTableAccounts ?? [],
  //   });
  //   additionalTxs.push(
  //     ...txs.map((tx) =>
  //       addTransactionMetadata(tx, {
  //         type: TransactionType.CREATE_ATA,
  //         addressLookupTables: addressLookupTableAccounts,
  //       })
  //     )
  //   );
  // }
  // // if crank is needed, add it
  // if (updateFeedIxs.length > 0) {
  //   const message = new TransactionMessage({
  //     payerKey: marginfiAccount.authority,
  //     recentBlockhash: blockhash,
  //     instructions: updateFeedIxs,
  //   }).compileToV0Message(feedLuts);
  //   additionalTxs.push(
  //     addTransactionMetadata(new VersionedTransaction(message), {
  //       addressLookupTables: feedLuts,
  //       type: TransactionType.CRANK,
  //     })
  //   );
  // }
  // const luts = [...(addressLookupTableAccounts ?? []), ...swapLookupTables];
  // // if cuRequestIxs are not present, priority fee ix is needed
  // // wallets add a priority fee ix by default breaking the flashloan tx so we need to add a placeholder priority fee ix
  // // docs: https://docs.phantom.app/developer-powertools/solana-priority-fees
  // const flashloanParams = {
  //   program,
  //   marginfiAccount,
  //   bankMap,
  //   addressLookupTableAccounts: luts,
  //   blockhash,
  //   // signers,
  // };
  // flashloanTx = await makeFlashLoanTx({
  //   ...flashloanParams,
  //   ixs: [
  //     ...cuRequestIxs,
  //     ...withdrawIxs.instructions,
  //     ...swapInstructions,
  //     ...depositIxs.instructions,
  //   ],
  // });
  // const txSize = getTxSize(flashloanTx);
  // // Debug actual transaction structure
  // console.log("\n=== ACTUAL TRANSACTION DEBUG ===");
  // console.log(`\n1. ACTUAL TX SIZE: ${txSize} bytes`);
  // const transactions = [...additionalTxs, flashloanTx];
  // return { transactions, txOverflown, swapQuote, amountToDeposit };
}
