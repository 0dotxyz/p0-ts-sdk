import { AccountRole, type Instruction } from "@solana/kit";
import { findAssociatedTokenPda } from "@solana-program/token";
import BigNumber from "bignumber.js";

import {
  MakeDepositIxParams,
  MakeDepositTxParams,
  MakeDriftDepositIxParams,
  MakeDriftDepositTxParams,
  MakeKaminoDepositIxParams,
  MakeKaminoDepositTxParams,
} from "../types";

import { DEFAULT_ADDRESS, TOKEN_2022_PROGRAM_ID, WSOL_MINT } from "~/constants";
import instructions from "~/instructions";
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
 * Creates a Drift deposit instruction for depositing assets into a Drift spot market.
 *
 * This function handles:
 * - Wrapping SOL to wSOL if needed (for native SOL deposits)
 * - Deriving necessary Drift protocol accounts (state, spot market vault)
 * - Creating the deposit instruction to the Drift spot market
 *
 * @param params - The parameters for creating the deposit instruction
 * @param params.programAddress - The marginfi program address
 * @param params.bank - The bank to deposit into (must have Drift integration configured)
 * @param params.tokenProgram - The token program ID (TOKEN_PROGRAM or TOKEN_2022_PROGRAM)
 * @param params.amount - The amount to deposit in UI units
 * @param params.accountAddress - The Marginfi account address
 * @param params.authority - The account authority; signs and owns the source token account
 * @param params.group - The Marginfi group address
 * @param params.driftMarketIndex - The Drift spot market index for the asset
 * @param params.driftOracle - The Drift oracle account for the asset
 * @param params.opts - Optional configuration
 * @param params.opts.wrapAndUnwrapSol - Whether to wrap SOL to wSOL (default: true)
 * @param params.opts.wSolBalanceUi - Existing wSOL balance to combine with native SOL (default: 0)
 *
 * @returns Promise resolving to the deposit instructions
 * @throws Error if the bank has no Drift integration accounts
 */
export async function makeDriftDepositIx({
  programAddress,
  bank,
  tokenProgram,
  amount,
  accountAddress,
  authority,
  group,
  driftMarketIndex,
  driftOracle,
  opts = {},
}: MakeDriftDepositIxParams): Promise<Instruction[]> {
  if (!bank.driftIntegrationAccounts) {
    throw new Error("Bank has no drift integration accounts");
  }

  const wrapAndUnwrapSol = opts.wrapAndUnwrapSol ?? true;
  const wSolBalanceUi = opts.wSolBalanceUi ?? 0;
  const depositIxs: Instruction[] = [];

  // We allow off curve addresses here to support Fuse.
  const [signerTokenAccount] = await findAssociatedTokenPda({
    mint: bank.mint,
    owner: authority.address,
    tokenProgram,
  });

  if (bank.mint === WSOL_MINT && wrapAndUnwrapSol) {
    depositIxs.push(
      ...(await makeWrapSolIxs(authority, new BigNumber(amount).minus(wSolBalanceUi)))
    );
  }

  const [[driftState], [driftSpotMarketVault]] = await Promise.all([
    deriveDriftState(),
    deriveDriftSpotMarketVault(driftMarketIndex),
  ]);

  depositIxs.push(
    await instructions.makeDriftDepositIx(programAddress, {
      group,
      marginfiAccount: accountAddress,
      authority,
      bank: bank.address,
      driftOracle,
      liquidityVault: bank.liquidityVault,
      signerTokenAccount,
      driftState,
      integrationAcc1: bank.driftIntegrationAccounts.driftSpotMarket,
      integrationAcc2: bank.driftIntegrationAccounts.driftUser,
      integrationAcc3: bank.driftIntegrationAccounts.driftUserStats,
      driftSpotMarketVault,
      mint: bank.mint,
      tokenProgram,
      amount: uiToNative(amount, bank.mintDecimals),
    })
  );

  return depositIxs;
}

/**
 * Creates a complete Drift deposit transaction ready to be signed and sent.
 *
 * This function builds a v0 transaction message that includes:
 * - SOL wrapping instructions if depositing native SOL
 * - The actual deposit instruction to the Drift spot market
 *
 * The authority pays the fees and is the only signer.
 *
 * @param params - The parameters for creating the deposit transaction
 * @param params.rpc - RPC client, for the blockhash
 * @param params.luts - Address lookup tables for transaction compression
 * @param params.latestBlockhash - Optional recent blockhash (fetched if not provided)
 * @param params.amount - The amount to deposit in UI units
 * @param params.bank - The bank to deposit into (must have Drift integration configured)
 * @param params.driftMarketIndex - The Drift spot market index for the asset
 * @param params.driftOracle - The Drift oracle account for the asset
 *
 * @returns Promise resolving to the deposit transaction
 * @throws Error if the bank has no Drift integration accounts
 */
export async function makeDriftDepositTx(
  params: MakeDriftDepositTxParams
): Promise<SolanaTransaction> {
  const { rpc, luts, latestBlockhash, ...depositIxParams } = params;

  const depositIxs = await makeDriftDepositIx(depositIxParams);

  return {
    message: makeTransactionMessage({
      instructions: depositIxs,
      feePayer: params.authority,
      latestBlockhash:
        latestBlockhash ?? (await rpc.getLatestBlockhash({ commitment: "confirmed" }).send()).value,
      luts: selectLutsForBanks(luts, [params.bank]),
    }),
    type: TransactionType.DEPOSIT,
  };
}

/**
 * Creates a Kamino deposit instruction for depositing assets into a Kamino reserve.
 *
 * This function handles:
 * - Wrapping SOL to wSOL if needed (for native SOL deposits)
 * - Deriving all necessary Kamino protocol accounts
 * - Creating the deposit instruction with proper farm state integration
 *
 * @param params - The parameters for creating the deposit instruction
 * @param params.programAddress - The marginfi program address
 * @param params.bank - The bank to deposit into
 * @param params.tokenProgram - The token program ID (TOKEN_PROGRAM or TOKEN_2022_PROGRAM)
 * @param params.amount - The amount to deposit in UI units
 * @param params.accountAddress - The Marginfi account address
 * @param params.authority - The account authority; signs and owns the source token account
 * @param params.group - The Marginfi group address
 * @param params.reserve - The Kamino reserve configuration
 * @param params.opts - Optional configuration
 * @param params.opts.wrapAndUnwrapSol - Whether to wrap SOL to wSOL (default: true)
 * @param params.opts.wSolBalanceUi - Existing wSOL balance to combine with native SOL (default: 0)
 *
 * @returns Promise resolving to the deposit instructions
 * @throws Error if the bank has no Kamino integration accounts
 */
export async function makeKaminoDepositIx({
  programAddress,
  bank,
  tokenProgram,
  amount,
  accountAddress,
  authority,
  group,
  reserve,
  opts = {},
}: MakeKaminoDepositIxParams): Promise<Instruction[]> {
  if (!bank.kaminoIntegrationAccounts) {
    throw new Error("Bank has no kamino integration accounts");
  }

  const wrapAndUnwrapSol = opts.wrapAndUnwrapSol ?? true;
  const wSolBalanceUi = opts.wSolBalanceUi ?? 0;
  const depositIxs: Instruction[] = [];

  // We allow off curve addresses here to support Fuse.
  const [signerTokenAccount] = await findAssociatedTokenPda({
    mint: bank.mint,
    owner: authority.address,
    tokenProgram,
  });

  if (bank.mint === WSOL_MINT && wrapAndUnwrapSol) {
    depositIxs.push(
      ...(await makeWrapSolIxs(authority, new BigNumber(amount).minus(wSolBalanceUi)))
    );
  }

  const [lendingMarketAuthority] = await deriveLendingMarketAuthority(reserve.lendingMarket);
  const reserveFarmState =
    reserve.farmCollateral === DEFAULT_ADDRESS ? undefined : reserve.farmCollateral;
  const obligationFarmUserState =
    reserveFarmState &&
    (await deriveUserState(reserveFarmState, bank.kaminoIntegrationAccounts.kaminoObligation))[0];

  depositIxs.push(
    await instructions.makeKaminoDepositIx(programAddress, {
      group,
      marginfiAccount: accountAddress,
      authority,
      bank: bank.address,
      signerTokenAccount,
      liquidityVault: bank.liquidityVault,
      integrationAcc1: bank.kaminoIntegrationAccounts.kaminoReserve,
      integrationAcc2: bank.kaminoIntegrationAccounts.kaminoObligation,
      lendingMarket: reserve.lendingMarket,
      lendingMarketAuthority,
      mint: bank.mint,
      reserveLiquiditySupply: reserve.liquidity.supplyVault,
      reserveCollateralMint: reserve.collateral.mintPubkey,
      reserveDestinationDepositCollateral: reserve.collateral.supplyVault,
      obligationFarmUserState,
      reserveFarmState,
      liquidityTokenProgram: tokenProgram,
      amount: uiToNative(amount, bank.mintDecimals),
      refreshReserve: null,
    })
  );

  return depositIxs;
}

/**
 * Creates a complete Kamino deposit transaction ready to be signed and sent.
 *
 * This function builds a v0 transaction message that includes:
 * - Kamino reserve and obligation refresh instructions
 * - SOL wrapping instructions if depositing native SOL
 * - The actual deposit instruction
 *
 * The authority pays the fees and is the only signer.
 *
 * @param params - The parameters for creating the deposit transaction
 * @param params.rpc - RPC client, for the blockhash
 * @param params.luts - Address lookup tables for transaction compression
 * @param params.latestBlockhash - Optional recent blockhash (fetched if not provided)
 * @param params.amount - The amount to deposit in UI units
 * @param params.bank - The bank to deposit into (must have kaminoReserve and kaminoObligation)
 * @param params.reserve - The Kamino reserve configuration
 *
 * @returns Promise resolving to the deposit transaction
 * @throws Error if the bank has no Kamino integration accounts
 */
export async function makeKaminoDepositTx(
  params: MakeKaminoDepositTxParams
): Promise<SolanaTransaction> {
  const { rpc, luts, latestBlockhash, ...depositIxParams } = params;

  if (!params.bank.kaminoIntegrationAccounts) {
    throw new Error("Bank has no kamino integration accounts");
  }

  const refreshIxs = makeRefreshingIxs(
    params.bank.kaminoIntegrationAccounts.kaminoReserve,
    params.reserve,
    params.bank.kaminoIntegrationAccounts.kaminoObligation
  );

  const depositIxs = await makeKaminoDepositIx(depositIxParams);

  return {
    message: makeTransactionMessage({
      instructions: [...refreshIxs, ...depositIxs],
      feePayer: params.authority,
      latestBlockhash:
        latestBlockhash ?? (await rpc.getLatestBlockhash({ commitment: "confirmed" }).send()).value,
      luts: selectLutsForBanks(luts, [params.bank]),
    }),
    type: TransactionType.DEPOSIT,
  };
}

/**
 * Creates a deposit instruction for depositing assets into a Marginfi bank.
 *
 * This function handles:
 * - Wrapping SOL to wSOL if depositing native SOL
 * - Token-2022 program support with proper remaining accounts
 * - Creating the deposit instruction to the bank's liquidity vault
 *
 * @param params - The parameters for creating the deposit instruction
 * @param params.programAddress - The marginfi program address
 * @param params.bank - The bank to deposit into
 * @param params.tokenProgram - The token program ID (TOKEN_PROGRAM or TOKEN_2022_PROGRAM)
 * @param params.amount - The amount to deposit in UI units
 * @param params.accountAddress - The Marginfi account address
 * @param params.authority - The account authority; signs and owns the source token account
 * @param params.group - The Marginfi group address
 * @param params.opts - Optional configuration
 * @param params.opts.wrapAndUnwrapSol - Whether to wrap SOL to wSOL (default: true)
 * @param params.opts.wSolBalanceUi - Existing wSOL balance to combine with native SOL (default: 0)
 *
 * @returns Promise resolving to the deposit instructions
 */
export async function makeDepositIx({
  programAddress,
  bank,
  tokenProgram,
  amount,
  accountAddress,
  authority,
  group,
  opts = {},
}: MakeDepositIxParams): Promise<Instruction[]> {
  const wrapAndUnwrapSol = opts.wrapAndUnwrapSol ?? true;
  const wSolBalanceUi = opts.wSolBalanceUi ?? 0;
  const depositIxs: Instruction[] = [];

  // We allow off curve addresses here to support Fuse.
  const [signerTokenAccount] = await findAssociatedTokenPda({
    mint: bank.mint,
    owner: authority.address,
    tokenProgram,
  });

  if (bank.mint === WSOL_MINT && wrapAndUnwrapSol) {
    depositIxs.push(
      ...(await makeWrapSolIxs(authority, new BigNumber(amount).minus(wSolBalanceUi)))
    );
  }

  depositIxs.push(
    await instructions.makeDepositIx(
      programAddress,
      {
        group,
        marginfiAccount: accountAddress,
        authority,
        bank: bank.address,
        signerTokenAccount,
        liquidityVault: bank.liquidityVault,
        tokenProgram,
        amount: uiToNative(amount, bank.mintDecimals),
        depositUpToLimit: null,
      },
      tokenProgram === TOKEN_2022_PROGRAM_ID
        ? [{ address: bank.mint, role: AccountRole.READONLY }]
        : []
    )
  );

  return depositIxs;
}

/**
 * Creates a complete deposit transaction ready to be signed and sent.
 *
 * This function builds a v0 transaction message that includes:
 * - SOL wrapping instructions if depositing native SOL
 * - The actual deposit instruction to the Marginfi bank
 * - Proper support for Token-2022 tokens
 *
 * The authority pays the fees and is the only signer.
 *
 * @param params - The parameters for creating the deposit transaction
 * @param params.rpc - RPC client, for the blockhash
 * @param params.luts - Address lookup tables for transaction compression
 * @param params.latestBlockhash - Optional recent blockhash (fetched if not provided)
 * @param params.bank - The bank to deposit into
 * @param params.amount - The amount to deposit in UI units
 *
 * @returns Promise resolving to the deposit transaction
 */
export async function makeDepositTx(params: MakeDepositTxParams): Promise<SolanaTransaction> {
  const { rpc, luts, latestBlockhash, ...depositIxParams } = params;

  const depositIxs = await makeDepositIx(depositIxParams);

  return {
    message: makeTransactionMessage({
      instructions: depositIxs,
      feePayer: params.authority,
      latestBlockhash:
        latestBlockhash ?? (await rpc.getLatestBlockhash({ commitment: "confirmed" }).send()).value,
      // Deposits don't add health remaining-accounts, so only the target bank matters.
      luts: selectLutsForBanks(luts, [params.bank]),
    }),
    type: TransactionType.DEPOSIT,
  };
}

/**
 * Creates a JupLend deposit instruction for depositing assets into a JupLend lending pool.
 *
 * This function handles:
 * - Wrapping SOL to wSOL if needed (for native SOL deposits)
 * - Deriving all necessary JupLend protocol accounts via `getAllDerivedJupLendAccounts`
 * - Creating the deposit instruction to the JupLend lending pool
 *
 * @param params - The parameters for creating the deposit instruction
 * @param params.programAddress - The marginfi program address
 * @param params.bank - The bank to deposit into (must have JupLend integration configured)
 * @param params.tokenProgram - The token program ID (TOKEN_PROGRAM or TOKEN_2022_PROGRAM)
 * @param params.amount - The amount to deposit in UI units
 * @param params.accountAddress - The Marginfi account address
 * @param params.authority - The account authority; signs and owns the source token account
 * @param params.group - The Marginfi group address
 * @param params.opts - Optional configuration
 * @param params.opts.wrapAndUnwrapSol - Whether to wrap SOL to wSOL (default: true)
 * @param params.opts.wSolBalanceUi - Existing wSOL balance to combine with native SOL (default: 0)
 *
 * @returns Promise resolving to the deposit instructions
 * @throws Error if the bank has no JupLend integration accounts
 */
export async function makeJuplendDepositIx({
  programAddress,
  bank,
  tokenProgram,
  amount,
  accountAddress,
  authority,
  group,
  opts = {},
}: MakeDepositIxParams): Promise<Instruction[]> {
  if (!bank.jupLendIntegrationAccounts) {
    throw new Error("Bank has no JupLend integration accounts");
  }

  const wrapAndUnwrapSol = opts.wrapAndUnwrapSol ?? true;
  const wSolBalanceUi = opts.wSolBalanceUi ?? 0;
  const depositIxs: Instruction[] = [];

  const [signerTokenAccount] = await findAssociatedTokenPda({
    mint: bank.mint,
    owner: authority.address,
    tokenProgram,
  });

  if (bank.mint === WSOL_MINT && wrapAndUnwrapSol) {
    depositIxs.push(
      ...(await makeWrapSolIxs(authority, new BigNumber(amount).minus(wSolBalanceUi)))
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
      group,
      marginfiAccount: accountAddress,
      authority,
      bank: bank.address,
      signerTokenAccount,
      liquidityVault: bank.liquidityVault,
      mint: bank.mint,
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
      amount: uiToNative(amount, bank.mintDecimals),
    })
  );

  return depositIxs;
}

/**
 * Creates a complete JupLend deposit transaction ready to be signed and sent.
 *
 * This function builds a v0 transaction message that includes:
 * - SOL wrapping instructions if depositing native SOL
 * - The actual deposit instruction to the JupLend lending pool
 *
 * The authority pays the fees and is the only signer.
 *
 * @param params - The parameters for creating the deposit transaction
 * @param params.rpc - RPC client, for the blockhash
 * @param params.luts - Address lookup tables for transaction compression
 * @param params.latestBlockhash - Optional recent blockhash (fetched if not provided)
 * @param params.amount - The amount to deposit in UI units
 * @param params.bank - The bank to deposit into (must have JupLend integration configured)
 *
 * @returns Promise resolving to the deposit transaction
 * @throws Error if the bank has no JupLend integration accounts
 */
export async function makeJuplendDepositTx(
  params: MakeDepositTxParams
): Promise<SolanaTransaction> {
  const { rpc, luts, latestBlockhash, ...depositIxParams } = params;

  const depositIxs = await makeJuplendDepositIx(depositIxParams);

  return {
    message: makeTransactionMessage({
      instructions: depositIxs,
      feePayer: params.authority,
      latestBlockhash:
        latestBlockhash ?? (await rpc.getLatestBlockhash({ commitment: "confirmed" }).send()).value,
      luts: selectLutsForBanks(luts, [params.bank]),
    }),
    type: TransactionType.DEPOSIT,
  };
}
