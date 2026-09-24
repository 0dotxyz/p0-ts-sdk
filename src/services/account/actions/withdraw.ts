import { AccountRole, type Instruction } from "@solana/kit";
import {
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstruction,
} from "@solana-program/token";
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

import { DEFAULT_ADDRESS, TOKEN_2022_PROGRAM_ID, WSOL_MINT } from "~/constants";
import instructions from "~/instructions";
import { makeRefreshIntegrationBanksIxs } from "~/services/price";
import {
  makeTransactionMessage,
  makeUnwrapSolIx,
  selectLutsForAccountAction,
  TransactionType,
} from "~/services/transaction";
import { resolveAmount } from "~/types";
import { uiToNative } from "~/utils";
import { getAllDerivedDriftAccounts } from "~/vendor/drift";
import { getAllDerivedJupLendAccounts } from "~/vendor/jup-lend";
import { deriveLendingMarketAuthority, deriveUserState } from "~/vendor/klend";

export async function makeDriftWithdrawIx({
  programAddress,
  bank,
  bankMap,
  tokenProgram,
  amount,
  marginfiAccount,
  driftSpotMarket,
  userRewards,
  authority,
  withdrawAll = false,
  opts = {},
}: MakeDriftWithdrawIxParams): Promise<Instruction[]> {
  if (!bank.driftIntegrationAccounts) {
    throw new Error("Bank has no drift integration accounts");
  }

  const wrapAndUnwrapSol = opts.wrapAndUnwrapSol ?? true;
  const createAtas = opts.createAtas ?? true;
  const withdrawIxs: Instruction[] = [];

  // We allow off curve addresses here to support Fuse.
  const [destinationTokenAccount] = await findAssociatedTokenPda({
    mint: bank.mint,
    owner: authority.address,
    tokenProgram,
  });

  if (createAtas) {
    withdrawIxs.push(
      getCreateAssociatedTokenIdempotentInstruction({
        payer: authority,
        ata: destinationTokenAccount,
        owner: authority.address,
        mint: bank.mint,
        tokenProgram,
      })
    );
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

  const { driftState, driftSigner, driftSpotMarketVault } = await getAllDerivedDriftAccounts(
    driftSpotMarket.marketIndex
  );

  // On withdraw-all the bank is excluded from the health pack (its balance closes), but
  // its accounts are appended at the end: the 1.9 program searches the slice for the
  // withdrawn bank's oracle when the group rate limiter is enabled (extra trailing
  // accounts are ignored by 1.8).
  const remainingAccounts =
    opts.observationBanksOverride ??
    computeHealthAccountMetas({
      banksToInclude: healthAccounts,
      trailingBanks: withdrawAll ? [bank] : [],
    });

  if (userRewards.length > 2) {
    console.error(
      `Warning: User has ${userRewards.length} Drift rewards, but only 2 are supported. Using first 2 only.`
    );
  }

  withdrawIxs.push(
    await instructions.makeDriftWithdrawIx(
      programAddress,
      {
        group: marginfiAccount.group,
        marginfiAccount: marginfiAccount.address,
        authority,
        bank: bank.address,
        driftOracle: driftSpotMarket.oracle,
        liquidityVault: bank.liquidityVault,
        destinationTokenAccount,
        driftState,
        integrationAcc1: bank.driftIntegrationAccounts.driftSpotMarket,
        integrationAcc2: bank.driftIntegrationAccounts.driftUser,
        integrationAcc3: bank.driftIntegrationAccounts.driftUserStats,
        driftSpotMarketVault,
        driftRewardOracle: userRewards[0]?.oracle,
        driftRewardSpotMarket: userRewards[0]?.spotMarket,
        driftRewardMint: userRewards[0]?.mint,
        driftRewardOracle2: userRewards[1]?.oracle,
        driftRewardSpotMarket2: userRewards[1]?.spotMarket,
        driftRewardMint2: userRewards[1]?.mint,
        driftSigner,
        mint: bank.mint,
        tokenProgram,
        amount: uiToNative(amount, bank.mintDecimals),
        withdrawAll,
      },
      remainingAccounts.map((address) => ({ address, role: AccountRole.READONLY }))
    )
  );

  if (wrapAndUnwrapSol && bank.mint === WSOL_MINT) {
    withdrawIxs.push(await makeUnwrapSolIx(authority));
  }

  return withdrawIxs;
}

export async function makeDriftWithdrawTx(
  params: MakeDriftWithdrawTxParams
): Promise<TransactionBuilderResult> {
  const { rpc, luts, latestBlockhash, bankMetadataMap, ...withdrawIxParams } = params;

  const withdrawIxs = await makeDriftWithdrawIx(withdrawIxParams);

  const refreshIntegrationIxs = await makeRefreshIntegrationBanksIxs(
    params.marginfiAccount,
    params.bankMap,
    [params.bank.address],
    bankMetadataMap
  );

  const withdrawTx = {
    message: makeTransactionMessage({
      instructions: [...refreshIntegrationIxs, ...withdrawIxs],
      feePayer: params.authority,
      latestBlockhash:
        latestBlockhash ?? (await rpc.getLatestBlockhash({ commitment: "confirmed" }).send()).value,
      luts: selectLutsForAccountAction(
        luts,
        params.bank,
        params.marginfiAccount.balances,
        params.bankMap
      ),
    }),
    type: TransactionType.WITHDRAW,
  };

  return { transactions: [withdrawTx], actionTxIndex: 0 };
}

export async function makeKaminoWithdrawIx({
  programAddress,
  bank,
  bankMap,
  tokenProgram,
  cTokenAmount,
  marginfiAccount,
  reserve,
  authority,
  withdrawAll = false,
  opts = {},
}: MakeKaminoWithdrawIxParams): Promise<Instruction[]> {
  if (!bank.kaminoIntegrationAccounts) {
    throw new Error("Bank has no kamino integration accounts");
  }

  const wrapAndUnwrapSol = opts.wrapAndUnwrapSol ?? true;
  const createAtas = opts.createAtas ?? true;
  const withdrawIxs: Instruction[] = [];

  // We allow off curve addresses here to support Fuse.
  const [destinationTokenAccount] = await findAssociatedTokenPda({
    mint: bank.mint,
    owner: authority.address,
    tokenProgram,
  });

  if (createAtas) {
    withdrawIxs.push(
      getCreateAssociatedTokenIdempotentInstruction({
        payer: authority,
        ata: destinationTokenAccount,
        owner: authority.address,
        mint: bank.mint,
        tokenProgram,
      })
    );
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

  const [lendingMarketAuthority] = await deriveLendingMarketAuthority(reserve.lendingMarket);
  const reserveFarmState =
    reserve.farmCollateral === DEFAULT_ADDRESS ? undefined : reserve.farmCollateral;
  const obligationFarmUserState =
    reserveFarmState &&
    (await deriveUserState(reserveFarmState, bank.kaminoIntegrationAccounts.kaminoObligation))[0];

  // On withdraw-all the bank is excluded from the health pack (its balance closes), but
  // its accounts are appended at the end: the 1.9 program searches the slice for the
  // withdrawn bank's oracle when the group rate limiter is enabled (extra trailing
  // accounts are ignored by 1.8).
  const remainingAccounts =
    opts.observationBanksOverride ??
    computeHealthAccountMetas({
      banksToInclude: healthAccounts,
      trailingBanks: withdrawAll ? [bank] : [],
    });

  withdrawIxs.push(
    await instructions.makeKaminoWithdrawIx(
      programAddress,
      {
        group: marginfiAccount.group,
        marginfiAccount: marginfiAccount.address,
        authority,
        bank: bank.address,
        destinationTokenAccount,
        liquidityVault: bank.liquidityVault,
        integrationAcc1: bank.kaminoIntegrationAccounts.kaminoReserve,
        integrationAcc2: bank.kaminoIntegrationAccounts.kaminoObligation,
        lendingMarket: reserve.lendingMarket,
        lendingMarketAuthority,
        mint: bank.mint,
        reserveLiquiditySupply: reserve.liquidity.supplyVault,
        reserveCollateralMint: reserve.collateral.mintPubkey,
        reserveSourceCollateral: reserve.collateral.supplyVault,
        obligationFarmUserState,
        reserveFarmState,
        liquidityTokenProgram: tokenProgram,
        amount: uiToNative(cTokenAmount, bank.mintDecimals),
        isFinalWithdrawal: withdrawAll,
      },
      remainingAccounts.map((address) => ({ address, role: AccountRole.READONLY }))
    )
  );

  if (wrapAndUnwrapSol && bank.mint === WSOL_MINT) {
    withdrawIxs.push(await makeUnwrapSolIx(authority));
  }

  return withdrawIxs;
}

export async function makeWithdrawIx({
  programAddress,
  bank,
  bankMap,
  tokenProgram,
  amount,
  marginfiAccount,
  authority,
  withdrawAll = false,
  opts = {},
}: MakeWithdrawIxParams): Promise<Instruction[]> {
  const wrapAndUnwrapSol = opts.wrapAndUnwrapSol ?? true;
  const createAtas = opts.createAtas ?? true;
  const withdrawIxs: Instruction[] = [];

  // We allow off curve addresses here to support Fuse.
  const [destinationTokenAccount] = await findAssociatedTokenPda({
    mint: bank.mint,
    owner: authority.address,
    tokenProgram,
  });

  if (createAtas) {
    withdrawIxs.push(
      getCreateAssociatedTokenIdempotentInstruction({
        payer: authority,
        ata: destinationTokenAccount,
        owner: authority.address,
        mint: bank.mint,
        tokenProgram,
      })
    );
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

  const remainingAccounts = tokenProgram === TOKEN_2022_PROGRAM_ID ? [bank.mint] : [];
  // On withdraw-all the bank is excluded from the health pack (its balance closes), but
  // its accounts are appended at the end: the 1.9 program searches the slice for the
  // withdrawn bank's oracle when the group rate limiter is enabled (extra trailing
  // accounts are ignored by 1.8).
  remainingAccounts.push(
    ...(opts.observationBanksOverride ??
      computeHealthAccountMetas({
        banksToInclude: healthAccounts,
        trailingBanks: withdrawAll ? [bank] : [],
      }))
  );

  withdrawIxs.push(
    await instructions.makeWithdrawIx(
      programAddress,
      {
        group: marginfiAccount.group,
        marginfiAccount: marginfiAccount.address,
        authority,
        bank: bank.address,
        destinationTokenAccount,
        liquidityVault: bank.liquidityVault,
        tokenProgram,
        amount: uiToNative(amount, bank.mintDecimals),
        withdrawAll,
      },
      remainingAccounts.map((address) => ({ address, role: AccountRole.READONLY }))
    )
  );

  if (wrapAndUnwrapSol && bank.mint === WSOL_MINT) {
    withdrawIxs.push(await makeUnwrapSolIx(authority));
  }

  return withdrawIxs;
}

export async function makeWithdrawTx(
  params: MakeWithdrawTxParams
): Promise<TransactionBuilderResult> {
  const { rpc, luts, latestBlockhash, bankMetadataMap, ...withdrawIxParams } = params;

  const withdrawIxs = await makeWithdrawIx(withdrawIxParams);

  const refreshIntegrationIxs = await makeRefreshIntegrationBanksIxs(
    params.marginfiAccount,
    params.bankMap,
    [params.bank.address],
    bankMetadataMap
  );

  const withdrawTx = {
    message: makeTransactionMessage({
      instructions: [...refreshIntegrationIxs, ...withdrawIxs],
      feePayer: params.authority,
      latestBlockhash:
        latestBlockhash ?? (await rpc.getLatestBlockhash({ commitment: "confirmed" }).send()).value,
      // Pick the lean native-stake LUT subset when every involved bank (target + the
      // account's active positions) is STAKED/SOL.
      luts: selectLutsForAccountAction(
        luts,
        params.bank,
        params.marginfiAccount.balances,
        params.bankMap
      ),
    }),
    type: TransactionType.WITHDRAW,
  };

  return { transactions: [withdrawTx], actionTxIndex: 0 };
}

export async function makeKaminoWithdrawTx(
  params: MakeKaminoWithdrawTxParams
): Promise<TransactionBuilderResult> {
  const {
    rpc,
    luts,
    latestBlockhash,
    bankMetadataMap,
    amount,
    assetShareValueMultiplierByBank,
    ...withdrawIxParams
  } = params;

  const { value: amountValue, type: amountType } = resolveAmount(amount);
  const multiplier = assetShareValueMultiplierByBank.get(params.bank.address) ?? new BigNumber(1);
  const cTokenAmount =
    amountType === "cToken"
      ? new BigNumber(amountValue).toNumber()
      : new BigNumber(amountValue).div(multiplier).toNumber();

  const refreshIntegrationIxs = await makeRefreshIntegrationBanksIxs(
    params.marginfiAccount,
    params.bankMap,
    [params.bank.address],
    bankMetadataMap
  );

  const withdrawIxs = await makeKaminoWithdrawIx({ ...withdrawIxParams, cTokenAmount });

  const withdrawTx = {
    message: makeTransactionMessage({
      instructions: [...refreshIntegrationIxs, ...withdrawIxs],
      feePayer: params.authority,
      latestBlockhash:
        latestBlockhash ?? (await rpc.getLatestBlockhash({ commitment: "confirmed" }).send()).value,
      luts: selectLutsForAccountAction(
        luts,
        params.bank,
        params.marginfiAccount.balances,
        params.bankMap
      ),
    }),
    type: TransactionType.WITHDRAW,
  };

  return { transactions: [withdrawTx], actionTxIndex: 0 };
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
 * @param params.programAddress - The marginfi program address
 * @param params.bank - The bank to withdraw from (must have JupLend integration configured)
 * @param params.bankMap - Map of all banks for health check computation
 * @param params.tokenProgram - The token program ID (TOKEN_PROGRAM or TOKEN_2022_PROGRAM)
 * @param params.amount - The amount to withdraw in UI units
 * @param params.marginfiAccount - The Marginfi account to withdraw from
 * @param params.authority - The account authority; signs and owns the destination token account
 * @param params.jupLendingState - The on-chain JupLend lending state (provides token reserve and rewards accounts)
 * @param params.withdrawAll - Whether to withdraw the full balance (default: false)
 * @param params.opts - Optional configuration
 * @param params.opts.wrapAndUnwrapSol - Whether to unwrap wSOL to native SOL (default: true)
 * @param params.opts.createAtas - Whether to create the destination ATA if missing (default: true)
 * @param params.opts.observationBanksOverride - Optional override for health check remaining accounts
 *
 * @returns Promise resolving to the withdraw instructions
 * @throws Error if the bank has no JupLend integration accounts
 */
export async function makeJuplendWithdrawIx({
  programAddress,
  bank,
  bankMap,
  tokenProgram,
  amount,
  marginfiAccount,
  jupLendingState,
  authority,
  withdrawAll = false,
  opts = {},
}: MakeJuplendWithdrawIxParams): Promise<Instruction[]> {
  if (!bank.jupLendIntegrationAccounts) {
    throw new Error("Bank has no JupLend integration accounts");
  }

  const wrapAndUnwrapSol = opts.wrapAndUnwrapSol ?? true;
  const createAtas = opts.createAtas ?? true;
  const withdrawIxs: Instruction[] = [];

  const [destinationTokenAccount] = await findAssociatedTokenPda({
    mint: bank.mint,
    owner: authority.address,
    tokenProgram,
  });

  if (createAtas) {
    withdrawIxs.push(
      getCreateAssociatedTokenIdempotentInstruction({
        payer: authority,
        ata: destinationTokenAccount,
        owner: authority.address,
        mint: bank.mint,
        tokenProgram,
      })
    );
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

  const { fTokenMint, lendingAdmin, rateModel, vault, liquidity } =
    await getAllDerivedJupLendAccounts(bank.mint, tokenProgram);

  // On withdraw-all the bank is excluded from the health pack (its balance closes), but
  // its accounts are appended at the end: the 1.9 program searches the slice for the
  // withdrawn bank's oracle when the group rate limiter is enabled (extra trailing
  // accounts are ignored by 1.8).
  const remainingAccounts =
    opts.observationBanksOverride ??
    computeHealthAccountMetas({
      banksToInclude: healthAccounts,
      trailingBanks: withdrawAll ? [bank] : [],
    });

  withdrawIxs.push(
    await instructions.makeJuplendWithdrawIx(
      programAddress,
      {
        group: marginfiAccount.group,
        marginfiAccount: marginfiAccount.address,
        authority,
        bank: bank.address,
        destinationTokenAccount,
        mint: bank.mint,
        integrationAcc1: bank.jupLendIntegrationAccounts.jupLendingState,
        fTokenMint,
        integrationAcc2: bank.jupLendIntegrationAccounts.jupFTokenVault,
        integrationAcc3: bank.jupLendIntegrationAccounts.jupFTokenAta,
        lendingAdmin,
        supplyTokenReservesLiquidity: jupLendingState.tokenReservesLiquidity,
        lendingSupplyPositionOnLiquidity: jupLendingState.supplyPositionOnLiquidity,
        rateModel,
        vault,
        claimAccount: bank.jupLendIntegrationAccounts.jupFTokenAta,
        liquidity,
        rewardsRateModel: jupLendingState.rewardsRateModel,
        tokenProgram,
        amount: uiToNative(amount, bank.mintDecimals),
        withdrawAll,
      },
      remainingAccounts.map((address) => ({ address, role: AccountRole.READONLY }))
    )
  );

  if (wrapAndUnwrapSol && bank.mint === WSOL_MINT) {
    withdrawIxs.push(await makeUnwrapSolIx(authority));
  }

  return withdrawIxs;
}

export async function makeJuplendWithdrawTx(
  params: MakeJuplendWithdrawTxParams
): Promise<TransactionBuilderResult> {
  const { rpc, luts, latestBlockhash, bankMetadataMap, ...withdrawIxParams } = params;

  const withdrawIxs = await makeJuplendWithdrawIx(withdrawIxParams);

  const refreshIntegrationIxs = await makeRefreshIntegrationBanksIxs(
    params.marginfiAccount,
    params.bankMap,
    [params.bank.address],
    bankMetadataMap
  );

  const withdrawTx = {
    message: makeTransactionMessage({
      instructions: [...refreshIntegrationIxs, ...withdrawIxs],
      feePayer: params.authority,
      latestBlockhash:
        latestBlockhash ?? (await rpc.getLatestBlockhash({ commitment: "confirmed" }).send()).value,
      luts: selectLutsForAccountAction(
        luts,
        params.bank,
        params.marginfiAccount.balances,
        params.bankMap
      ),
    }),
    type: TransactionType.WITHDRAW,
  };

  return { transactions: [withdrawTx], actionTxIndex: 0 };
}
