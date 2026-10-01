import type { Instruction } from "@solana/kit";
import { findAssociatedTokenPda } from "@solana-program/token";
import { BigNumber } from "bignumber.js";

import { MakeDepositIxParams, MakeDepositTxParams } from "../types";

import { DEFAULT_ADDRESS, WSOL_MINT } from "~/constants";
import { TransactionBuildingError } from "~/errors";
import instructions from "~/instructions";
import { AssetTag } from "~/services/bank";
import {
  makeTransactionMessage,
  makeWrapSolIxs,
  selectLutsForBanks,
  SolanaTransaction,
  TransactionType,
} from "~/services/transaction";
import { uiToNative } from "~/utils";
import { deriveDriftSpotMarketVault, deriveDriftState } from "~/vendor/drift";
import { getAllDerivedJupLendAccounts } from "~/vendor/jup-lend";
import { deriveLendingMarketAuthority, deriveUserState, makeRefreshingIxs } from "~/vendor/klend";

/**
 * Deposits `amount` (UI units of the bank's mint) into `bank`, routed to the bank's venue
 * (marginfi, Kamino, Drift or JupLend). A wSOL deposit first wraps native SOL, net of
 * `opts.wSolBalanceUi`, unless `opts.wrapAndUnwrapSol` is false.
 * @throws TransactionBuildingError if a Kamino, Drift or JupLend bank's venue state or
 * integration accounts are missing
 */
export async function makeDepositIx({
  programAddress,
  bank,
  tokenProgram,
  amount,
  marginfiAccount,
  authority,
  bankMetadataMap,
  opts = {},
}: MakeDepositIxParams): Promise<Instruction[]> {
  const depositIxs: Instruction[] = [];

  if (bank.mint === WSOL_MINT && (opts.wrapAndUnwrapSol ?? true)) {
    depositIxs.push(
      ...(await makeWrapSolIxs(authority, new BigNumber(amount).minus(opts.wSolBalanceUi ?? 0)))
    );
  }

  const [signerTokenAccount] = await findAssociatedTokenPda({
    mint: bank.mint,
    owner: authority.address,
    tokenProgram,
  });
  const accounts = {
    group: marginfiAccount.group,
    marginfiAccount: marginfiAccount.address,
    authority,
    bank: bank.address,
    signerTokenAccount,
    liquidityVault: bank.liquidityVault,
    mint: bank.mint,
    amount: uiToNative(amount, bank.mintDecimals),
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
      const [lendingMarketAuthority] = await deriveLendingMarketAuthority(reserve.lendingMarket);
      const reserveFarmState =
        reserve.farmCollateral === DEFAULT_ADDRESS ? undefined : reserve.farmCollateral;
      const obligationFarmUserState =
        reserveFarmState &&
        (
          await deriveUserState(reserveFarmState, bank.kaminoIntegrationAccounts.kaminoObligation)
        )[0];

      depositIxs.push(
        await instructions.makeKaminoDepositIx(programAddress, {
          ...accounts,
          integrationAcc1: bank.kaminoIntegrationAccounts.kaminoReserve,
          integrationAcc2: bank.kaminoIntegrationAccounts.kaminoObligation,
          lendingMarket: reserve.lendingMarket,
          lendingMarketAuthority,
          reserveLiquiditySupply: reserve.liquidity.supplyVault,
          reserveCollateralMint: reserve.collateral.mintPubkey,
          reserveDestinationDepositCollateral: reserve.collateral.supplyVault,
          obligationFarmUserState,
          reserveFarmState,
          liquidityTokenProgram: tokenProgram,
          refreshReserve: null,
        })
      );
      break;
    }

    case AssetTag.DRIFT: {
      const spotMarket = bankMetadataMap?.[bank.address]?.driftStates?.spotMarketState;
      if (!spotMarket || !bank.driftIntegrationAccounts) {
        throw TransactionBuildingError.driftStateNotFound(
          bank.address,
          bank.mint,
          bank.tokenSymbol
        );
      }
      const [[driftState], [driftSpotMarketVault]] = await Promise.all([
        deriveDriftState(),
        deriveDriftSpotMarketVault(spotMarket.marketIndex),
      ]);

      depositIxs.push(
        await instructions.makeDriftDepositIx(programAddress, {
          ...accounts,
          driftOracle: spotMarket.oracle,
          driftState,
          integrationAcc1: bank.driftIntegrationAccounts.driftSpotMarket,
          integrationAcc2: bank.driftIntegrationAccounts.driftUser,
          integrationAcc3: bank.driftIntegrationAccounts.driftUserStats,
          driftSpotMarketVault,
          tokenProgram,
        })
      );
      break;
    }

    case AssetTag.JUPLEND: {
      if (!bank.jupLendIntegrationAccounts) {
        throw TransactionBuildingError.jupLendStateNotFound(
          bank.address,
          bank.mint,
          bank.tokenSymbol
        );
      }
      const {
        fTokenMint,
        lendingAdmin,
        supplyTokenReservesLiquidity,
        lendingSupplyPositionOnLiquidity,
        rateModel,
        vault,
        liquidity,
        rewardsRateModel,
      } = await getAllDerivedJupLendAccounts(bank.mint, tokenProgram);

      depositIxs.push(
        await instructions.makeJuplendDepositIx(programAddress, {
          ...accounts,
          integrationAcc1: bank.jupLendIntegrationAccounts.jupLendingState,
          fTokenMint,
          integrationAcc2: bank.jupLendIntegrationAccounts.jupFTokenVault,
          lendingAdmin,
          supplyTokenReservesLiquidity,
          lendingSupplyPositionOnLiquidity,
          rateModel,
          vault,
          liquidity,
          rewardsRateModel,
          tokenProgram,
        })
      );
      break;
    }

    default:
      depositIxs.push(
        await instructions.makeDepositIx(programAddress, {
          ...accounts,
          tokenProgram,
          depositUpToLimit: null,
        })
      );
  }

  return depositIxs;
}

/**
 * Builds a deposit transaction around {@link makeDepositIx}; a Kamino deposit first refreshes
 * its reserve and obligation. The authority pays and signs; `latestBlockhash` is fetched when
 * omitted.
 * @throws see {@link makeDepositIx}
 */
export async function makeDepositTx(params: MakeDepositTxParams): Promise<SolanaTransaction> {
  const { rpc, luts, latestBlockhash, version, ...depositIxParams } = params;
  const { bank, bankMetadataMap } = params;

  const depositIxs = await makeDepositIx(depositIxParams);

  const kaminoAccounts = bank.kaminoIntegrationAccounts;
  const reserve = bankMetadataMap?.[bank.address]?.kaminoStates?.reserveState;
  const refreshIxs =
    kaminoAccounts && reserve
      ? makeRefreshingIxs(kaminoAccounts.kaminoReserve, reserve, kaminoAccounts.kaminoObligation)
      : [];

  return {
    message: makeTransactionMessage({
      instructions: [...refreshIxs, ...depositIxs],
      feePayer: params.authority,
      latestBlockhash:
        latestBlockhash ?? (await rpc.getLatestBlockhash({ commitment: "confirmed" }).send()).value,
      // Deposits don't add health remaining-accounts, so only the target bank matters.
      luts: selectLutsForBanks(luts, [bank]),
      version,
    }),
    type: TransactionType.DEPOSIT,
  };
}
