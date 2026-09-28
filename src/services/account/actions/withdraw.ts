import type { Instruction } from "@solana/kit";
import {
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstruction,
} from "@solana-program/token";
import { BigNumber } from "bignumber.js";

import { MakeWithdrawIxParams, MakeWithdrawTxParams } from "../types";
import { computeHealthAccounts, getActiveBalances } from "../utils";

import { DEFAULT_ADDRESS, WSOL_MINT } from "~/constants";
import { TransactionBuildingError } from "~/errors";
import instructions from "~/instructions";
import { AssetTag } from "~/services/bank";
import { makeRefreshIntegrationBanksIxs } from "~/services/price";
import {
  makeTransactionMessage,
  makeUnwrapSolIx,
  selectLutsForAccountAction,
  SolanaTransaction,
  TransactionType,
} from "~/services/transaction";
import { resolveAmount } from "~/types";
import { uiToNative } from "~/utils";
import { getAllDerivedDriftAccounts } from "~/vendor/drift";
import { getAllDerivedJupLendAccounts } from "~/vendor/jup-lend";
import { deriveLendingMarketAuthority, deriveUserState } from "~/vendor/klend";

/**
 * Withdraws `amount` (UI units of the bank's mint) from `bank`, routed to the bank's venue
 * (marginfi, Kamino, Drift or JupLend); `withdrawAll` closes the balance. A Kamino `amount` may
 * also be a `cToken` amount; a UI amount is converted with the bank's asset-share multiplier. Creates
 * the destination ATA and unwraps wSOL unless `opts` disables it.
 * @throws TransactionBuildingError if a Kamino, Drift or JupLend bank's venue state or
 * integration accounts are missing
 * @throws Error if a `cToken` amount is given for a non-Kamino bank, or `bankMap` misses one of
 * the account's active banks
 */
export async function makeWithdrawIx({
  programAddress,
  bank,
  bankMap,
  tokenProgram,
  amount,
  marginfiAccount,
  authority,
  bankMetadataMap,
  assetShareValueMultiplierByBank,
  withdrawAll = false,
  opts = {},
}: MakeWithdrawIxParams): Promise<Instruction[]> {
  const withdrawIxs: Instruction[] = [];

  const [destinationTokenAccount] = await findAssociatedTokenPda({
    mint: bank.mint,
    owner: authority.address,
    tokenProgram,
  });

  if (opts.createAtas ?? true) {
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

  const activeBanks =
    opts.activeBanks ?? getActiveBalances(marginfiAccount.balances).map((b) => b.bankPk);
  // A withdraw-all closes the balance, so the bank leaves the health pack; the group rate limiter
  // still reads its price, from the accounts appended after the pack.
  const healthAccounts = withdrawAll
    ? computeHealthAccounts(
        bankMap,
        activeBanks.filter((b) => b !== bank.address),
        (opts.groupRateLimiterEnabled ?? true) ? [bank.address] : []
      )
    : computeHealthAccounts(bankMap, activeBanks);

  const { value: amountValue, type: amountType } = resolveAmount(amount);
  if (amountType === "cToken" && bank.config.assetTag !== AssetTag.KAMINO) {
    throw new Error(`cToken amounts only apply to Kamino banks (bank ${bank.address})`);
  }
  const accounts = {
    group: marginfiAccount.group,
    marginfiAccount: marginfiAccount.address,
    authority,
    bank: bank.address,
    destinationTokenAccount,
    liquidityVault: bank.liquidityVault,
    mint: bank.mint,
  };

  switch (bank.config.assetTag) {
    case AssetTag.KAMINO: {
      const reserve = bankMetadataMap?.[bank.address]?.kaminoStates?.reserveState;
      if (!reserve || !bank.kaminoIntegrationAccounts) {
        throw TransactionBuildingError.kaminoReserveNotFound(
          bank.address,
          bank.mint,
          bank.tokenSymbol
        );
      }
      const cTokenAmount =
        amountType === "cToken"
          ? amountValue
          : new BigNumber(amountValue).div(
              assetShareValueMultiplierByBank?.get(bank.address) ?? new BigNumber(1)
            );
      const [lendingMarketAuthority] = await deriveLendingMarketAuthority(reserve.lendingMarket);
      const reserveFarmState =
        reserve.farmCollateral === DEFAULT_ADDRESS ? undefined : reserve.farmCollateral;
      const obligationFarmUserState =
        reserveFarmState &&
        (
          await deriveUserState(reserveFarmState, bank.kaminoIntegrationAccounts.kaminoObligation)
        )[0];

      withdrawIxs.push(
        await instructions.makeKaminoWithdrawIx(
          programAddress,
          {
            ...accounts,
            integrationAcc1: bank.kaminoIntegrationAccounts.kaminoReserve,
            integrationAcc2: bank.kaminoIntegrationAccounts.kaminoObligation,
            lendingMarket: reserve.lendingMarket,
            lendingMarketAuthority,
            reserveLiquiditySupply: reserve.liquidity.supplyVault,
            reserveCollateralMint: reserve.collateral.mintPubkey,
            reserveSourceCollateral: reserve.collateral.supplyVault,
            obligationFarmUserState,
            reserveFarmState,
            liquidityTokenProgram: tokenProgram,
            amount: uiToNative(cTokenAmount, bank.mintDecimals),
            isFinalWithdrawal: withdrawAll,
          },
          healthAccounts
        )
      );
      break;
    }

    case AssetTag.DRIFT: {
      const driftStates = bankMetadataMap?.[bank.address]?.driftStates;
      if (!driftStates || !bank.driftIntegrationAccounts) {
        throw TransactionBuildingError.driftStateNotFound(
          bank.address,
          bank.mint,
          bank.tokenSymbol
        );
      }
      const { spotMarketState, userRewards } = driftStates;
      if (userRewards.length > 2) {
        console.error(
          `Warning: User has ${userRewards.length} Drift rewards, but only 2 are supported. Using first 2 only.`
        );
      }
      const { driftState, driftSigner, driftSpotMarketVault } = await getAllDerivedDriftAccounts(
        spotMarketState.marketIndex
      );

      withdrawIxs.push(
        await instructions.makeDriftWithdrawIx(
          programAddress,
          {
            ...accounts,
            driftOracle: spotMarketState.oracle,
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
            tokenProgram,
            amount: uiToNative(amountValue, bank.mintDecimals),
            withdrawAll,
          },
          healthAccounts
        )
      );
      break;
    }

    case AssetTag.JUPLEND: {
      const jupLendingState = bankMetadataMap?.[bank.address]?.jupLendStates?.jupLendingState;
      if (!jupLendingState || !bank.jupLendIntegrationAccounts) {
        throw TransactionBuildingError.jupLendStateNotFound(
          bank.address,
          bank.mint,
          bank.tokenSymbol
        );
      }
      const { fTokenMint, lendingAdmin, rateModel, vault, liquidity } =
        await getAllDerivedJupLendAccounts(bank.mint, tokenProgram);

      withdrawIxs.push(
        await instructions.makeJuplendWithdrawIx(
          programAddress,
          {
            ...accounts,
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
            amount: uiToNative(amountValue, bank.mintDecimals),
            withdrawAll,
          },
          healthAccounts
        )
      );
      break;
    }

    default:
      withdrawIxs.push(
        await instructions.makeWithdrawIx(
          programAddress,
          {
            ...accounts,
            tokenProgram,
            amount: uiToNative(amountValue, bank.mintDecimals),
            withdrawAll,
          },
          healthAccounts
        )
      );
  }

  if (bank.mint === WSOL_MINT && (opts.wrapAndUnwrapSol ?? true)) {
    withdrawIxs.push(await makeUnwrapSolIx(authority));
  }

  return withdrawIxs;
}

/**
 * Builds a withdraw transaction around {@link makeWithdrawIx}, preceded by the refreshes of the
 * account's integration banks. The authority pays and signs; `latestBlockhash` is fetched when
 * omitted.
 * @throws see {@link makeWithdrawIx}
 */
export async function makeWithdrawTx(params: MakeWithdrawTxParams): Promise<SolanaTransaction> {
  const { rpc, luts, latestBlockhash, ...withdrawIxParams } = params;
  const { bank, bankMap, marginfiAccount, bankMetadataMap } = params;

  const withdrawIxs = await makeWithdrawIx(withdrawIxParams);

  const refreshIxs = await makeRefreshIntegrationBanksIxs(
    marginfiAccount,
    bankMap,
    [bank.address],
    bankMetadataMap
  );

  return {
    message: makeTransactionMessage({
      instructions: [...refreshIxs, ...withdrawIxs],
      feePayer: params.authority,
      latestBlockhash:
        latestBlockhash ?? (await rpc.getLatestBlockhash({ commitment: "confirmed" }).send()).value,
      luts: selectLutsForAccountAction(luts, bank, marginfiAccount.balances, bankMap),
    }),
    type: TransactionType.WITHDRAW,
  };
}
