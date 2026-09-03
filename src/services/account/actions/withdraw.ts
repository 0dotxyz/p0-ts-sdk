import {
  PublicKey,
  TransactionInstruction,
  AddressLookupTableAccount,
  VersionedTransaction,
  TransactionMessage,
} from "@solana/web3.js";
import { BigNumber } from "bignumber.js";

import {
  MakeKaminoWithdrawIxParams,
  MakeWithdrawIxParams,
  MakeWithdrawTxParams,
  TransactionBuilderResult,
  MakeKaminoWithdrawTxParams,
  MakeDriftWithdrawTxParams,
  MakeDriftWithdrawIxParams,
  MakeJuplendWithdrawIxParams,
  MakeJuplendWithdrawTxParams,
} from "../types";
import { computeHealthCheckAccounts, computeHealthAccountMetas } from "../utils";

import instructions from "~/instructions";
import { makeRefreshIntegrationBanksIxs, makeSmartCrankSwbFeedIx } from "~/services/price";
import {
  addTransactionMetadata,
  ExtendedV0Transaction,
  InstructionsWrapper,
  makeUnwrapSolIx,
  selectLutsForAccountAction,
  TransactionType,
} from "~/services/transaction";
import syncInstructions from "~/sync-instructions";
import { resolveAmount } from "~/types";
import { uiToNative } from "~/utils";
import { getAllDerivedDriftAccounts } from "~/vendor/drift";
import { JUP_LIQUIDITY_PROGRAM_ID, getAllDerivedJupLendAccounts } from "~/vendor/jup-lend";
import { deriveUserState, FARMS_PROGRAM_ID, getAllDerivedKaminoAccounts } from "~/vendor/klend";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
  NATIVE_MINT,
  TOKEN_2022_PROGRAM_ID,
} from "~/vendor/spl";

export async function makeDriftWithdrawIx({
  program,
  bank,
  bankMap,
  tokenProgram,
  amount,
  marginfiAccount,
  driftSpotMarket,
  userRewards,
  authority,
  withdrawAll = false,
  isSync = false,
  opts = {},
}: MakeDriftWithdrawIxParams): Promise<InstructionsWrapper> {
  const wrapAndUnwrapSol = opts.wrapAndUnwrapSol ?? true;
  const createAtas = opts.createAtas ?? true;
  const withdrawIxs: TransactionInstruction[] = [];
  const remainingAccounts: PublicKey[] = [];

  const userTokenAtaPk = getAssociatedTokenAddressSync(bank.mint, authority, true, tokenProgram); // We allow off curve addresses here to support Fuse.

  if (createAtas) {
    const createAtaIdempotentIx = createAssociatedTokenAccountIdempotentInstruction(
      authority,
      userTokenAtaPk,
      authority,
      bank.mint,
      tokenProgram
    );
    withdrawIxs.push(createAtaIdempotentIx);
  }

  const healthAccounts = withdrawAll
    ? computeHealthCheckAccounts({
        account: marginfiAccount,
        banksMap: bankMap,
        excludedBanks: [bank.address],
      })
    : computeHealthCheckAccounts({
        account: marginfiAccount,
        banksMap: bankMap,
        mandatoryBanks: [bank.address],
      });

  const marketIndex = driftSpotMarket.marketIndex;
  const driftOracle = driftSpotMarket.oracle;

  const { driftState, driftSigner, driftSpotMarketVault } = getAllDerivedDriftAccounts(marketIndex);

  if (!bank.driftIntegrationAccounts) {
    throw new Error("Bank has no drift integration accounts");
  }

  if (opts.observationBanksOverride) {
    remainingAccounts.push(...opts.observationBanksOverride);
  } else {
    // On withdraw-all the bank is excluded from the health pack (its balance closes), but
    // its accounts are appended at the end: the 1.9 program searches the slice for the
    // withdrawn bank's oracle when the group rate limiter is enabled (extra trailing
    // accounts are ignored by 1.8).
    const accountMetas = computeHealthAccountMetas({
      banksToInclude: healthAccounts,
      trailingBanks: withdrawAll ? [bank] : [],
    });
    remainingAccounts.push(...accountMetas);
  }

  // Extract reward values from userRewards array
  // Handles 0, 1, 2, or 2+ rewards with proper error handling

  // Validate array length
  if (userRewards.length > 2) {
    console.error(
      `Warning: User has ${userRewards.length} Drift rewards, but only 2 are supported. Using first 2 only.`
    );
  }

  // Extract first reward (or null if empty)
  const driftRewardOracle = userRewards[0]?.oracle ?? null;
  const driftRewardSpotMarket = userRewards[0]?.spotMarket ?? null;
  const driftRewardMint = userRewards[0]?.mint ?? null;

  // Extract second reward (or null if not present)
  const driftRewardOracle2 = userRewards[1]?.oracle ?? null;
  const driftRewardSpotMarket2 = userRewards[1]?.spotMarket ?? null;
  const driftRewardMint2 = userRewards[1]?.mint ?? null;

  const withdrawIx = isSync
    ? syncInstructions.makeDriftWithdrawIx(
        program.programId,
        {
          group: opts.overrideInferAccounts?.group ?? marginfiAccount.group,
          marginfiAccount: marginfiAccount.address,
          authority: opts.overrideInferAccounts?.authority ?? marginfiAccount.authority,
          bank: bank.address,
          destinationTokenAccount: userTokenAtaPk,

          driftState,
          integrationAcc2: bank.driftIntegrationAccounts.driftUser,
          integrationAcc3: bank.driftIntegrationAccounts.driftUserStats,
          integrationAcc1: bank.driftIntegrationAccounts.driftSpotMarket,
          driftSpotMarketVault,
          driftSigner,
          liquidityVault: bank.liquidityVault,
          mint: bank.mint,
          tokenProgram,

          driftOracle,
          driftRewardOracle,
          driftRewardSpotMarket,
          driftRewardMint,
          driftRewardOracle2,
          driftRewardSpotMarket2,
          driftRewardMint2,
        },
        {
          amount: uiToNative(amount, bank.mintDecimals),
          withdrawAll,
        },
        remainingAccounts.map((account) => ({
          pubkey: account,
          isSigner: false,
          isWritable: false,
        }))
      )
    : await instructions.makeDriftWithdrawIx(
        program,
        {
          marginfiAccount: marginfiAccount.address,
          bank: bank.address,
          destinationTokenAccount: userTokenAtaPk,

          driftState,
          driftSigner,
          driftSpotMarketVault,
          tokenProgram,

          driftOracle,
          driftRewardOracle,
          driftRewardSpotMarket,
          driftRewardMint,
          driftRewardOracle2,
          driftRewardSpotMarket2,
          driftRewardMint2,

          authority: opts.overrideInferAccounts?.authority,
          group: opts.overrideInferAccounts?.group,
        },
        {
          amount: uiToNative(amount, bank.mintDecimals),
          withdrawAll,
        },
        remainingAccounts.map((account) => ({
          pubkey: account,
          isSigner: false,
          isWritable: false,
        }))
      );

  withdrawIxs.push(withdrawIx);

  if (wrapAndUnwrapSol && bank.mint.equals(NATIVE_MINT)) {
    withdrawIxs.push(makeUnwrapSolIx(authority));
  }

  return {
    instructions: withdrawIxs,
    keys: [],
  };
}

export async function makeDriftWithdrawTx(
  params: MakeDriftWithdrawTxParams
): Promise<TransactionBuilderResult> {
  const { luts, connection, ...withdrawIxParams } = params;

  const selectedLuts = selectLutsForAccountAction(
    luts,
    withdrawIxParams.bank,
    params.marginfiAccount.balances,
    params.bankMap
  );

  const hasLiabilities = params.marginfiAccount.balances.some((balance) => {
    return balance.liabilityShares.gt(0);
  });

  let updateFeedIxs: TransactionInstruction[] = [];
  let feedLuts: AddressLookupTableAccount[] = [];

  const withdrawIxs = await makeDriftWithdrawIx(withdrawIxParams);

  if (hasLiabilities) {
    const { instructions: _updateFeedIxs, luts: _feedLuts } = await makeSmartCrankSwbFeedIx({
      marginfiAccount: params.marginfiAccount,
      bankMap: params.bankMap,
      oraclePrices: params.oraclePrices,
      assetShareValueMultiplierByBank: params.assetShareValueMultiplierByBank,
      instructions: withdrawIxs.instructions,
      program: params.program,
      connection: params.connection,
      crossbarUrl: params.crossbarUrl,
    });
    updateFeedIxs = _updateFeedIxs;
    feedLuts = _feedLuts;
  }

  const refreshIntegrationIxs = makeRefreshIntegrationBanksIxs(
    params.marginfiAccount,
    params.bankMap,
    [withdrawIxParams.bank.address],
    params.bankMetadataMap
  );

  const {
    value: { blockhash },
  } = await connection.getLatestBlockhashAndContext("confirmed");

  const feedCrankTxs: ExtendedV0Transaction[] = [];

  if (updateFeedIxs.length > 0) {
    feedCrankTxs.push(
      addTransactionMetadata(
        new VersionedTransaction(
          new TransactionMessage({
            instructions: [...updateFeedIxs],
            payerKey: params.authority,
            recentBlockhash: blockhash,
          }).compileToV0Message(feedLuts)
        ),
        {
          addressLookupTables: feedLuts,
          type: TransactionType.CRANK,
        }
      )
    );
  }

  const withdrawTx = addTransactionMetadata(
    new VersionedTransaction(
      new TransactionMessage({
        instructions: [...refreshIntegrationIxs.instructions, ...withdrawIxs.instructions],
        payerKey: params.authority,
        recentBlockhash: blockhash,
      }).compileToV0Message(selectedLuts)
    ),
    {
      signers: [...refreshIntegrationIxs.keys, ...withdrawIxs.keys],
      addressLookupTables: selectedLuts,
      type: TransactionType.WITHDRAW,
    }
  );

  const transactions = [...feedCrankTxs, withdrawTx];

  return { transactions, actionTxIndex: transactions.length - 1 };
}

export async function makeKaminoWithdrawIx({
  program,
  bank,
  bankMap,
  tokenProgram,
  cTokenAmount,
  marginfiAccount,
  reserve,
  authority,
  withdrawAll = false,
  isSync = false,
  opts = {},
}: MakeKaminoWithdrawIxParams): Promise<InstructionsWrapper> {
  const wrapAndUnwrapSol = opts.wrapAndUnwrapSol ?? true;
  const createAtas = opts.createAtas ?? true;
  const withdrawIxs: TransactionInstruction[] = [];
  const remainingAccounts: PublicKey[] = [];

  const userTokenAtaPk = getAssociatedTokenAddressSync(bank.mint, authority, true, tokenProgram); // We allow off curve addresses here to support Fuse.

  if (createAtas) {
    const createAtaIdempotentIx = createAssociatedTokenAccountIdempotentInstruction(
      authority,
      userTokenAtaPk,
      authority,
      bank.mint,
      tokenProgram
    );
    withdrawIxs.push(createAtaIdempotentIx);
  }

  const healthAccounts = withdrawAll
    ? computeHealthCheckAccounts({
        account: marginfiAccount,
        banksMap: bankMap,
        excludedBanks: [bank.address],
      })
    : computeHealthCheckAccounts({
        account: marginfiAccount,
        banksMap: bankMap,
        mandatoryBanks: [bank.address],
      });

  const lendingMarket = reserve.lendingMarket;

  const reserveLiquiditySupply = reserve.liquidity.supplyVault;
  const reserveCollateralMint = reserve.collateral.mintPubkey;
  const reserveDestinationDepositCollateral = reserve.collateral.supplyVault;

  const { lendingMarketAuthority } = getAllDerivedKaminoAccounts(reserve.lendingMarket, bank.mint);

  if (!bank.kaminoIntegrationAccounts) {
    throw new Error("Bank has no kamino integration accounts");
  }

  const reserveFarm = !reserve.farmCollateral.equals(
    new PublicKey("11111111111111111111111111111111")
  )
    ? reserve.farmCollateral
    : null;

  const [userFarmState] = reserveFarm
    ? deriveUserState(
        FARMS_PROGRAM_ID,
        reserveFarm,
        bank.kaminoIntegrationAccounts.kaminoObligation
      )
    : [null];

  if (opts.observationBanksOverride) {
    remainingAccounts.push(...opts.observationBanksOverride);
  } else {
    // On withdraw-all the bank is excluded from the health pack (its balance closes), but
    // its accounts are appended at the end: the 1.9 program searches the slice for the
    // withdrawn bank's oracle when the group rate limiter is enabled (extra trailing
    // accounts are ignored by 1.8).
    const accountMetas = computeHealthAccountMetas({
      banksToInclude: healthAccounts,
      trailingBanks: withdrawAll ? [bank] : [],
    });
    remainingAccounts.push(...accountMetas);
  }

  const withdrawIx = isSync
    ? syncInstructions.makeKaminoWithdrawIx(
        program.programId,
        {
          group: opts.overrideInferAccounts?.group ?? marginfiAccount.group,
          marginfiAccount: marginfiAccount.address,
          authority: opts.overrideInferAccounts?.authority ?? marginfiAccount.authority,
          bank: bank.address,
          destinationTokenAccount: userTokenAtaPk,

          integrationAcc2: bank.kaminoIntegrationAccounts.kaminoObligation,
          lendingMarket,
          lendingMarketAuthority,
          integrationAcc1: bank.kaminoIntegrationAccounts.kaminoReserve,
          mint: bank.mint,
          reserveLiquiditySupply,
          reserveCollateralMint,

          reserveSourceCollateral: reserveDestinationDepositCollateral,
          liquidityTokenProgram: tokenProgram,

          obligationFarmUserState: userFarmState,
          reserveFarmState: reserveFarm,
        },
        {
          amount: uiToNative(cTokenAmount, bank.mintDecimals),
          isFinalWithdrawal: withdrawAll,
        },
        remainingAccounts.map((account) => ({
          pubkey: account,
          isSigner: false,
          isWritable: false,
        }))
      )
    : await instructions.makeKaminoWithdrawIx(
        program,
        {
          marginfiAccount: marginfiAccount.address,
          bank: bank.address,
          destinationTokenAccount: userTokenAtaPk,
          lendingMarket,
          mint: bank.mint,

          lendingMarketAuthority,
          reserveLiquiditySupply,
          reserveCollateralMint,

          reserveSourceCollateral: reserveDestinationDepositCollateral,
          liquidityTokenProgram: tokenProgram,

          obligationFarmUserState: userFarmState,
          reserveFarmState: reserveFarm,

          authority: opts.overrideInferAccounts?.authority ?? marginfiAccount.authority,
          group: opts.overrideInferAccounts?.group ?? marginfiAccount.group,
        },
        {
          amount: uiToNative(cTokenAmount, bank.mintDecimals),
          isFinalWithdrawal: withdrawAll,
        },
        remainingAccounts.map((account) => ({
          pubkey: account,
          isSigner: false,
          isWritable: false,
        }))
      );

  withdrawIxs.push(withdrawIx);

  if (wrapAndUnwrapSol && bank.mint.equals(NATIVE_MINT)) {
    withdrawIxs.push(makeUnwrapSolIx(authority));
  }

  return {
    instructions: withdrawIxs,
    keys: [],
  };
}

export async function makeWithdrawIx({
  program,
  bank,
  bankMap,
  tokenProgram,
  amount,
  marginfiAccount,
  authority,
  withdrawAll = false,
  isSync = false,
  opts = {},
}: MakeWithdrawIxParams): Promise<InstructionsWrapper> {
  const wrapAndUnwrapSol = opts.wrapAndUnwrapSol ?? true;
  const createAtas = opts.createAtas ?? true;

  const withdrawIxs = [];

  const userAta = getAssociatedTokenAddressSync(bank.mint, authority, true, tokenProgram); // We allow off curve addresses here to support Fuse.

  if (createAtas) {
    const createAtaIdempotentIx = createAssociatedTokenAccountIdempotentInstruction(
      authority,
      userAta,
      authority,
      bank.mint,
      tokenProgram
    );
    withdrawIxs.push(createAtaIdempotentIx);
  }

  const healthAccounts = withdrawAll
    ? computeHealthCheckAccounts({
        account: marginfiAccount,
        banksMap: bankMap,
        excludedBanks: [bank.address],
      })
    : computeHealthCheckAccounts({
        account: marginfiAccount,
        banksMap: bankMap,
        mandatoryBanks: [bank.address],
      });

  // Add withdraw-related instructions
  const remainingAccounts: PublicKey[] = [];
  if (tokenProgram.equals(TOKEN_2022_PROGRAM_ID)) {
    remainingAccounts.push(bank.mint);
  }
  if (opts.observationBanksOverride) {
    remainingAccounts.push(...opts.observationBanksOverride);
  } else {
    // On withdraw-all the bank is excluded from the health pack (its balance closes), but
    // its accounts are appended at the end: the 1.9 program searches the slice for the
    // withdrawn bank's oracle when the group rate limiter is enabled (extra trailing
    // accounts are ignored by 1.8).
    const accountMetas = computeHealthAccountMetas({
      banksToInclude: healthAccounts,
      trailingBanks: withdrawAll ? [bank] : [],
    });
    remainingAccounts.push(...accountMetas);
  }

  const withdrawIx = isSync
    ? syncInstructions.makeWithdrawIx(
        program.programId,
        {
          group: opts.overrideInferAccounts?.group ?? marginfiAccount.group,
          marginfiAccount: marginfiAccount.address,
          authority: opts.overrideInferAccounts?.authority ?? marginfiAccount.authority,
          bank: bank.address,
          destinationTokenAccount: userAta,
          tokenProgram: tokenProgram,
        },
        { amount: uiToNative(amount, bank.mintDecimals), withdrawAll },
        remainingAccounts.map((account) => ({
          pubkey: account,
          isSigner: false,
          isWritable: false,
        }))
      )
    : await instructions.makeWithdrawIx(
        program,
        {
          marginfiAccount: marginfiAccount.address,
          bank: bank.address,
          destinationTokenAccount: userAta,
          tokenProgram: tokenProgram,
          authority: opts.overrideInferAccounts?.authority ?? marginfiAccount.authority,
          group: opts.overrideInferAccounts?.group ?? marginfiAccount.group,
        },
        { amount: uiToNative(amount, bank.mintDecimals), withdrawAll },
        remainingAccounts.map((account) => ({
          pubkey: account,
          isSigner: false,
          isWritable: false,
        }))
      );

  withdrawIxs.push(withdrawIx);

  if (wrapAndUnwrapSol && bank.mint.equals(NATIVE_MINT)) {
    withdrawIxs.push(makeUnwrapSolIx(authority));
  }

  return {
    instructions: withdrawIxs,
    keys: [],
  };
}

export async function makeWithdrawTx(
  params: MakeWithdrawTxParams
): Promise<TransactionBuilderResult> {
  const { luts, connection, ...withdrawIxParams } = params;

  // Pick the lean native-stake LUT subset when every involved bank (target + the
  // account's active positions) is STAKED/SOL.
  const selectedLuts = selectLutsForAccountAction(
    luts,
    withdrawIxParams.bank,
    params.marginfiAccount.balances,
    params.bankMap
  );

  const hasLiabilities = params.marginfiAccount.balances.some((balance) => {
    return balance.liabilityShares.gt(0);
  });

  let updateFeedIxs: TransactionInstruction[] = [];
  let feedLuts: AddressLookupTableAccount[] = [];

  const withdrawIxs = await makeWithdrawIx(withdrawIxParams);

  if (hasLiabilities) {
    const { instructions: _updateFeedIxs, luts: _feedLuts } = await makeSmartCrankSwbFeedIx({
      marginfiAccount: params.marginfiAccount,
      bankMap: params.bankMap,
      oraclePrices: params.oraclePrices,
      assetShareValueMultiplierByBank: params.assetShareValueMultiplierByBank,
      instructions: withdrawIxs.instructions,
      program: params.program,
      connection: params.connection,
      crossbarUrl: params.crossbarUrl,
    });
    updateFeedIxs = _updateFeedIxs;
    feedLuts = _feedLuts;
  }

  const refreshIntegrationIxs = makeRefreshIntegrationBanksIxs(
    params.marginfiAccount,
    params.bankMap,
    [withdrawIxParams.bank.address],
    params.bankMetadataMap
  );

  const {
    value: { blockhash },
  } = await connection.getLatestBlockhashAndContext("confirmed");

  const feedCrankTxs: ExtendedV0Transaction[] = [];

  if (updateFeedIxs.length > 0) {
    feedCrankTxs.push(
      addTransactionMetadata(
        new VersionedTransaction(
          new TransactionMessage({
            instructions: [...updateFeedIxs],
            payerKey: params.authority,
            recentBlockhash: blockhash,
          }).compileToV0Message(feedLuts)
        ),
        {
          addressLookupTables: feedLuts,
          type: TransactionType.CRANK,
        }
      )
    );
  }

  const withdrawTx = addTransactionMetadata(
    new VersionedTransaction(
      new TransactionMessage({
        instructions: [...refreshIntegrationIxs.instructions, ...withdrawIxs.instructions],
        payerKey: params.authority,
        recentBlockhash: blockhash,
      }).compileToV0Message(selectedLuts)
    ),
    {
      signers: [...refreshIntegrationIxs.keys, ...withdrawIxs.keys],
      addressLookupTables: selectedLuts,
      type: TransactionType.WITHDRAW,
    }
  );

  const transactions = [...feedCrankTxs, withdrawTx];

  return { transactions, actionTxIndex: transactions.length - 1 };
}

export async function makeKaminoWithdrawTx(
  params: MakeKaminoWithdrawTxParams
): Promise<TransactionBuilderResult> {
  const { luts, connection, amount, assetShareValueMultiplierByBank, ...withdrawIxParams } = params;

  const selectedLuts = selectLutsForAccountAction(
    luts,
    withdrawIxParams.bank,
    params.marginfiAccount.balances,
    params.bankMap
  );

  if (!withdrawIxParams.bank.kaminoIntegrationAccounts) {
    throw new Error("Bank has no kamino integration accounts");
  }

  const { value: amountValue, type: amountType } = resolveAmount(amount);
  const multiplier =
    assetShareValueMultiplierByBank.get(withdrawIxParams.bank.address.toBase58()) ??
    new BigNumber(1);
  const adjustedAmount =
    amountType === "cToken"
      ? new BigNumber(amountValue).toNumber()
      : new BigNumber(amountValue).div(multiplier).toNumber();

  const refreshIntegrationIxs = makeRefreshIntegrationBanksIxs(
    params.marginfiAccount,
    params.bankMap,
    [withdrawIxParams.bank.address],
    params.bankMetadataMap
  );

  const withdrawIxs = await makeKaminoWithdrawIx({
    cTokenAmount: adjustedAmount,
    ...withdrawIxParams,
  });

  const { instructions: updateFeedIxs, luts: feedLuts } = await makeSmartCrankSwbFeedIx({
    marginfiAccount: params.marginfiAccount,
    bankMap: params.bankMap,
    oraclePrices: params.oraclePrices,
    instructions: withdrawIxs.instructions,
    assetShareValueMultiplierByBank: params.assetShareValueMultiplierByBank,
    program: params.program,
    connection: params.connection,
    crossbarUrl: params.crossbarUrl,
  });

  const {
    value: { blockhash },
  } = await connection.getLatestBlockhashAndContext("confirmed");

  const feedCrankTxs: ExtendedV0Transaction[] = [];

  if (updateFeedIxs.length > 0) {
    feedCrankTxs.push(
      addTransactionMetadata(
        new VersionedTransaction(
          new TransactionMessage({
            instructions: [...updateFeedIxs],
            payerKey: params.authority,
            recentBlockhash: blockhash,
          }).compileToV0Message(feedLuts)
        ),
        {
          addressLookupTables: feedLuts,
          type: TransactionType.CRANK,
        }
      )
    );
  }

  const withdrawTx = addTransactionMetadata(
    new VersionedTransaction(
      new TransactionMessage({
        instructions: [...refreshIntegrationIxs.instructions, ...withdrawIxs.instructions],
        payerKey: params.authority,
        recentBlockhash: blockhash,
      }).compileToV0Message(selectedLuts)
    ),
    {
      signers: [...refreshIntegrationIxs.keys, ...withdrawIxs.keys],
      addressLookupTables: selectedLuts,
      type: TransactionType.WITHDRAW,
    }
  );

  const transactions = [...feedCrankTxs, withdrawTx];

  return { transactions, actionTxIndex: transactions.length - 1 };
}

/**
 * Creates a JupLend withdraw instruction for withdrawing assets from a JupLend lending pool.
 *
 * This function handles:
 * - Creating the destination ATA if needed (idempotent)
 * - Computing health check accounts for the withdrawal
 * - Deriving JupLend protocol accounts via `getAllDerivedJupLendAccounts` (fTokenMint, rateModel, vault, liquidity, lendingAdmin)
 * - Using on-chain `jupLendingState` values for supplyTokenReservesLiquidity, lendingSupplyPositionOnLiquidity, and rewardsRateModel
 * - Unwrapping wSOL back to native SOL if needed
 *
 * @param params - The parameters for creating the withdraw instruction
 * @param params.program - The Marginfi program instance
 * @param params.bank - The bank to withdraw from (must have JupLend integration configured)
 * @param params.bankMap - Map of all banks for health check computation
 * @param params.tokenProgram - The token program ID (TOKEN_PROGRAM or TOKEN_2022_PROGRAM)
 * @param params.amount - The amount to withdraw in UI units
 * @param params.marginfiAccount - The Marginfi account to withdraw from
 * @param params.authority - The authority/signer public key
 * @param params.jupLendingState - The on-chain JupLend lending state (provides token reserve and rewards accounts)
 * @param params.withdrawAll - Whether to withdraw the full balance (default: false)
 * @param params.opts - Optional configuration
 * @param params.opts.wrapAndUnwrapSol - Whether to unwrap wSOL to native SOL (default: true)
 * @param params.opts.createAtas - Whether to create the destination ATA if missing (default: true)
 * @param params.opts.overrideInferAccounts - Optional account overrides for testing/special cases
 * @param params.opts.observationBanksOverride - Optional override for health check remaining accounts
 *
 * @returns Promise resolving to InstructionsWrapper containing the withdraw instructions
 */
export async function makeJuplendWithdrawIx({
  program,
  bank,
  bankMap,
  tokenProgram,
  amount,
  marginfiAccount,
  jupLendingState,
  authority,
  withdrawAll = false,
  opts = {},
}: MakeJuplendWithdrawIxParams): Promise<InstructionsWrapper> {
  const wrapAndUnwrapSol = opts.wrapAndUnwrapSol ?? true;
  const createAtas = opts.createAtas ?? true;
  const withdrawIxs: TransactionInstruction[] = [];
  const remainingAccounts: PublicKey[] = [];

  const userTokenAtaPk = getAssociatedTokenAddressSync(bank.mint, authority, true, tokenProgram);

  if (createAtas) {
    const createAtaIdempotentIx = createAssociatedTokenAccountIdempotentInstruction(
      authority,
      userTokenAtaPk,
      authority,
      bank.mint,
      tokenProgram
    );
    withdrawIxs.push(createAtaIdempotentIx);
  }

  const healthAccounts = withdrawAll
    ? computeHealthCheckAccounts({
        account: marginfiAccount,
        banksMap: bankMap,
        excludedBanks: [bank.address],
      })
    : computeHealthCheckAccounts({
        account: marginfiAccount,
        banksMap: bankMap,
        mandatoryBanks: [bank.address],
      });

  if (!bank.jupLendIntegrationAccounts) {
    throw new Error("Bank has no JupLend integration accounts");
  }
  const {
    fTokenMint,
    lendingAdmin,
    rateModel,
    vault,
    liquidity,
  } = getAllDerivedJupLendAccounts(bank.mint, tokenProgram);

  if (opts.observationBanksOverride) {
    remainingAccounts.push(...opts.observationBanksOverride);
  } else {
    // On withdraw-all the bank is excluded from the health pack (its balance closes), but
    // its accounts are appended at the end: the 1.9 program searches the slice for the
    // withdrawn bank's oracle when the group rate limiter is enabled (extra trailing
    // accounts are ignored by 1.8).
    const accountMetas = computeHealthAccountMetas({
      banksToInclude: healthAccounts,
      trailingBanks: withdrawAll ? [bank] : [],
    });
    remainingAccounts.push(...accountMetas);
  }

  const withdrawIx = await instructions.makeJuplendWithdrawIx(
    program,
    {
      marginfiAccount: marginfiAccount.address,
      bank: bank.address,
      destinationTokenAccount: userTokenAtaPk,

      lendingAdmin,
      supplyTokenReservesLiquidity: jupLendingState.tokenReservesLiquidity,
      lendingSupplyPositionOnLiquidity: jupLendingState.supplyPositionOnLiquidity,
      rateModel,
      vault: vault,
      claimAccount: bank.jupLendIntegrationAccounts.jupFTokenAta,
      liquidity,
      liquidityProgram: JUP_LIQUIDITY_PROGRAM_ID,
      rewardsRateModel: jupLendingState.rewardsRateModel,
      tokenProgram,

      authority: opts.overrideInferAccounts?.authority ?? authority,
      group: opts.overrideInferAccounts?.group,
      mint: bank.mint,
      fTokenMint,
      integrationAcc1: bank.jupLendIntegrationAccounts.jupLendingState,
      integrationAcc2: bank.jupLendIntegrationAccounts.jupFTokenVault,
      integrationAcc3: bank.jupLendIntegrationAccounts.jupFTokenAta,
    },
    {
      amount: uiToNative(amount, bank.mintDecimals),
      withdrawAll,
    },
    remainingAccounts.map((account) => ({
      pubkey: account,
      isSigner: false,
      isWritable: false,
    }))
  );

  withdrawIxs.push(withdrawIx);

  if (wrapAndUnwrapSol && bank.mint.equals(NATIVE_MINT)) {
    withdrawIxs.push(makeUnwrapSolIx(authority));
  }

  return {
    instructions: withdrawIxs,
    keys: [],
  };
}

export async function makeJuplendWithdrawTx(
  params: MakeJuplendWithdrawTxParams
): Promise<TransactionBuilderResult> {
  const { luts, connection, ...withdrawIxParams } = params;

  const selectedLuts = selectLutsForAccountAction(
    luts,
    withdrawIxParams.bank,
    params.marginfiAccount.balances,
    params.bankMap
  );

  const hasLiabilities = params.marginfiAccount.balances.some((balance) => {
    return balance.liabilityShares.gt(0);
  });

  let updateFeedIxs: TransactionInstruction[] = [];
  let feedLuts: AddressLookupTableAccount[] = [];

  const withdrawIxs = await makeJuplendWithdrawIx(withdrawIxParams);

  if (hasLiabilities) {
    const { instructions: _updateFeedIxs, luts: _feedLuts } = await makeSmartCrankSwbFeedIx({
      marginfiAccount: params.marginfiAccount,
      bankMap: params.bankMap,
      oraclePrices: params.oraclePrices,
      assetShareValueMultiplierByBank: params.assetShareValueMultiplierByBank,
      instructions: withdrawIxs.instructions,
      program: params.program,
      connection: params.connection,
      crossbarUrl: params.crossbarUrl,
    });
    updateFeedIxs = _updateFeedIxs;
    feedLuts = _feedLuts;
  }

  const refreshIntegrationIxs = makeRefreshIntegrationBanksIxs(
    params.marginfiAccount,
    params.bankMap,
    [withdrawIxParams.bank.address],
    params.bankMetadataMap
  );

  const {
    value: { blockhash },
  } = await connection.getLatestBlockhashAndContext("confirmed");

  const feedCrankTxs: ExtendedV0Transaction[] = [];

  if (updateFeedIxs.length > 0) {
    feedCrankTxs.push(
      addTransactionMetadata(
        new VersionedTransaction(
          new TransactionMessage({
            instructions: [...updateFeedIxs],
            payerKey: params.authority,
            recentBlockhash: blockhash,
          }).compileToV0Message(feedLuts)
        ),
        {
          addressLookupTables: feedLuts,
          type: TransactionType.CRANK,
        }
      )
    );
  }

  const withdrawTx = addTransactionMetadata(
    new VersionedTransaction(
      new TransactionMessage({
        instructions: [...refreshIntegrationIxs.instructions, ...withdrawIxs.instructions],
        payerKey: params.authority,
        recentBlockhash: blockhash,
      }).compileToV0Message(selectedLuts)
    ),
    {
      signers: [...refreshIntegrationIxs.keys, ...withdrawIxs.keys],
      addressLookupTables: selectedLuts,
      type: TransactionType.WITHDRAW,
    }
  );

  const transactions = [...feedCrankTxs, withdrawTx];

  return { transactions, actionTxIndex: transactions.length - 1 };
}
