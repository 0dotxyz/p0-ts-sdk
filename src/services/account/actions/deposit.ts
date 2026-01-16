import {
  PublicKey,
  Transaction,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import BigNumber from "bignumber.js";
import { AnchorProvider, Program } from "@coral-xyz/anchor";

import { getAssociatedTokenAddressSync, NATIVE_MINT, TOKEN_2022_PROGRAM_ID } from "~/vendor/spl";
import {
  deriveUserState,
  FARMS_PROGRAM_ID,
  getAllDerivedKaminoAccounts,
  KLEND_IDL,
  KlendIdlType,
  makeRefreshingIxs,
} from "~/vendor/klend";
import { uiToNative } from "~/utils";
import {
  addTransactionMetadata,
  ExtendedTransaction,
  ExtendedV0Transaction,
  InstructionsWrapper,
  makeWrapSolIxs,
  TransactionType,
} from "~/services/transaction";
import syncInstructions from "~/sync-instructions";
import instructions from "~/instructions";

import {
  MakeDepositIxParams,
  MakeDepositTxParams,
  MakeDriftDepositIxParams,
  MakeDriftDepositTxParams,
  MakeKaminoDepositIxParams,
  MakeKaminoDepositTxParams,
} from "../types";

/**
 * Creates a Kamino deposit instruction for depositing assets into a Kamino reserve.
 *
 * This function handles:
 * - Wrapping SOL to wSOL if needed (for native SOL deposits)
 * - Deriving all necessary Kamino protocol accounts
 * - Creating the deposit instruction with proper farm state integration
 *
 * @param params - The parameters for creating the deposit instruction
 * @param params.program - The Marginfi program instance
 * @param params.bank - The bank to deposit into
 * @param params.tokenProgram - The token program ID (TOKEN_PROGRAM or TOKEN_2022_PROGRAM)
 * @param params.amount - The amount to deposit in UI units
 * @param params.accountAddress - The Marginfi account address
 * @param params.authority - The authority/signer public key
 * @param params.group - The Marginfi group address
 * @param params.reserve - The Kamino reserve configuration
 * @param params.opts - Optional configuration
 * @param params.opts.wrapAndUnwrapSol - Whether to wrap SOL to wSOL (default: true)
 * @param params.opts.wSolBalanceUi - Existing wSOL balance to combine with native SOL (default: 0)
 * @param params.opts.overrideInferAccounts - Optional account overrides for testing/special cases
 *
 * @returns Promise resolving to InstructionsWrapper containing the deposit instructions
 */
export async function makeKaminoDepositIx({
  program,
  bank,
  tokenProgram,
  amount,
  accountAddress,
  authority,
  group,
  reserve,
  isSync,
  opts = {
    // If false, the deposit will not wrap SOL; should not be false in most usecases
    wrapAndUnwrapSol: true,
    // wSOL balance can be provided if the user wants to combine native and wrapped SOL
    wSolBalanceUi: 0,
  },
}: MakeKaminoDepositIxParams): Promise<InstructionsWrapper> {
  const wrapAndUnwrapSol = opts.wrapAndUnwrapSol ?? true;
  const wSolBalanceUi = opts.wSolBalanceUi ?? 0;
  const depositIxs: TransactionInstruction[] = [];

  const userTokenAtaPk = getAssociatedTokenAddressSync(bank.mint, authority, true, tokenProgram); // We allow off curve addresses here to support Fuse.

  const {
    lendingMarketAuthority,
    reserveLiquiditySupply,
    reserveCollateralMint,
    reserveDestinationDepositCollateral,
  } = getAllDerivedKaminoAccounts(reserve.lendingMarket, bank.mint);

  if (bank.mint.equals(NATIVE_MINT) && wrapAndUnwrapSol) {
    depositIxs.push(...makeWrapSolIxs(authority, new BigNumber(amount).minus(wSolBalanceUi)));
  }

  const reserveFarm = !reserve.farmCollateral.equals(
    new PublicKey("11111111111111111111111111111111")
  )
    ? reserve.farmCollateral
    : null;

  const [userFarmState] = reserveFarm
    ? deriveUserState(FARMS_PROGRAM_ID, reserveFarm, bank.kaminoObligation)
    : [null];

  const depositIx = isSync
    ? syncInstructions.makeKaminoDepositIx(
        program.programId,
        {
          marginfiAccount: accountAddress,
          bank: bank.address,
          signerTokenAccount: userTokenAtaPk,
          lendingMarket: reserve.lendingMarket,
          reserveLiquidityMint: bank.mint,

          kaminoObligation: bank.kaminoObligation,
          kaminoReserve: bank.kaminoReserve,
          mint: bank.mint,

          lendingMarketAuthority,
          reserveLiquiditySupply,
          reserveCollateralMint,
          reserveDestinationDepositCollateral,
          liquidityTokenProgram: tokenProgram,

          obligationFarmUserState: userFarmState,
          reserveFarmState: reserveFarm,

          authority: opts.overrideInferAccounts?.authority ?? authority,
          group: opts.overrideInferAccounts?.group ?? group,
        },
        { amount: uiToNative(amount, bank.mintDecimals) }
      )
    : await instructions.makeKaminoDepositIx(
        program,
        {
          marginfiAccount: accountAddress,
          bank: bank.address,
          signerTokenAccount: userTokenAtaPk,
          lendingMarket: reserve.lendingMarket,
          reserveLiquidityMint: bank.mint,

          lendingMarketAuthority,
          reserveLiquiditySupply,
          reserveCollateralMint,
          reserveDestinationDepositCollateral,
          liquidityTokenProgram: tokenProgram,

          obligationFarmUserState: userFarmState,
          reserveFarmState: reserveFarm,

          authority: opts.overrideInferAccounts?.authority ?? authority,
          group: opts.overrideInferAccounts?.group ?? group,
          liquidityVault: opts.overrideInferAccounts?.liquidityVault,
        },
        { amount: uiToNative(amount, bank.mintDecimals) }
      );

  depositIxs.push(depositIx);

  return {
    instructions: depositIxs,
    keys: [],
  };
}

/**
 * Creates a complete Kamino deposit transaction ready to be signed and sent.
 *
 * This function builds a full versioned transaction that includes:
 * - Kamino reserve refresh instructions (to update oracle prices and interest rates)
 * - SOL wrapping instructions if depositing native SOL
 * - The actual deposit instruction
 *
 * The transaction is constructed with proper metadata, address lookup tables,
 * and is ready to be signed by the authority and submitted to the network.
 *
 * @param params - The parameters for creating the deposit transaction
 * @param params.luts - Address lookup tables for transaction compression
 * @param params.connection - Solana connection for fetching blockhash and reserve data
 * @param params.amount - The amount to deposit in UI units
 * @param params.blockhash - Optional recent blockhash (fetched if not provided)
 * @param params.program - The Marginfi program instance
 * @param params.bank - The bank to deposit into (must have kaminoReserve and kaminoObligation)
 * @param params.tokenProgram - The token program ID
 * @param params.accountAddress - The Marginfi account address
 * @param params.authority - The authority/signer public key
 * @param params.group - The Marginfi group address
 * @param params.reserve - The Kamino reserve configuration
 * @param params.opts - Optional configuration (wrapping, overrides, etc.)
 *
 * @returns Promise resolving to a versioned transaction with metadata
 * @throws Error if the bank doesn't have a Kamino reserve or obligation configured
 */
export async function makeKaminoDepositTx(
  params: MakeKaminoDepositTxParams
): Promise<ExtendedV0Transaction> {
  const { luts, connection, amount, ...depositIxParams } = params;

  if (!depositIxParams.bank.kaminoReserve) {
    throw new Error("Bank has no kamino reserve");
  }

  if (!depositIxParams.bank.kaminoObligation) {
    throw new Error("Bank has no kamino obligation");
  }

  // TODO: create dummy provider util in common
  const provider = new AnchorProvider(
    connection,
    {
      publicKey: params.authority,
      signTransaction: async (tx) => tx,
      signAllTransactions: async (txs) => txs,
    },
    {
      commitment: "confirmed",
    }
  );

  const klendProgram = new Program<KlendIdlType>(KLEND_IDL, provider);

  const refreshIxs = await makeRefreshingIxs({
    klendProgram,
    reserve: depositIxParams.reserve,
    reserveKey: depositIxParams.bank.kaminoReserve,
    obligationKey: depositIxParams.bank.kaminoObligation,
    program: klendProgram,
  });

  const depositIxs = await makeKaminoDepositIx({
    amount,
    ...depositIxParams,
  });

  const blockhash =
    params.blockhash ??
    (await connection.getLatestBlockhashAndContext("confirmed")).value.blockhash;

  const depositTx = addTransactionMetadata(
    new VersionedTransaction(
      new TransactionMessage({
        instructions: [...refreshIxs, ...depositIxs.instructions],
        payerKey: params.authority,
        recentBlockhash: blockhash,
      }).compileToV0Message(luts)
    ),
    {
      signers: depositIxs.keys,
      addressLookupTables: luts,
      type: TransactionType.DEPOSIT,
    }
  );

  const solanaTx = addTransactionMetadata(depositTx, {
    type: TransactionType.DEPOSIT,
    signers: depositIxs.keys,
    addressLookupTables: luts,
  });
  return solanaTx;
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
 * @param params.program - The Marginfi program instance
 * @param params.bank - The bank to deposit into
 * @param params.tokenProgram - The token program ID (TOKEN_PROGRAM or TOKEN_2022_PROGRAM)
 * @param params.amount - The amount to deposit in UI units
 * @param params.accountAddress - The Marginfi account address
 * @param params.authority - The authority/signer public key
 * @param params.group - The Marginfi group address
 * @param params.opts - Optional configuration
 * @param params.opts.wrapAndUnwrapSol - Whether to wrap SOL to wSOL (default: true)
 * @param params.opts.wSolBalanceUi - Existing wSOL balance to combine with native SOL (default: 0)
 * @param params.opts.overrideInferAccounts - Optional account overrides for testing/special cases
 *
 * @returns Promise resolving to InstructionsWrapper containing the deposit instructions
 */
export async function makeDepositIx({
  program,
  bank,
  tokenProgram,
  amount,
  accountAddress,
  authority,
  group,
  isSync,
  opts = {
    // If false, the deposit will not wrap SOL; should not be false in most usecases
    wrapAndUnwrapSol: true,
    // wSOL balance can be provided if the user wants to combine native and wrapped SOL
    wSolBalanceUi: 0,
  },
}: MakeDepositIxParams): Promise<InstructionsWrapper> {
  const wrapAndUnwrapSol = opts.wrapAndUnwrapSol ?? true;
  const wSolBalanceUi = opts.wSolBalanceUi ?? 0;

  const userTokenAtaPk = getAssociatedTokenAddressSync(bank.mint, authority, true, tokenProgram); // We allow off curve addresses here to support Fuse.

  const remainingAccounts = tokenProgram.equals(TOKEN_2022_PROGRAM_ID)
    ? [{ pubkey: bank.mint, isSigner: false, isWritable: false }]
    : [];

  const depositIxs = [];

  if (bank.mint.equals(NATIVE_MINT) && wrapAndUnwrapSol) {
    depositIxs.push(...makeWrapSolIxs(authority, new BigNumber(amount).minus(wSolBalanceUi)));
  }

  const depositIx = isSync
    ? syncInstructions.makeDepositIx(
        program.programId,
        {
          marginfiAccount: accountAddress,
          signerTokenAccount: userTokenAtaPk,
          bank: bank.address,
          tokenProgram: tokenProgram,
          authority: opts.overrideInferAccounts?.authority ?? authority,
          group: opts.overrideInferAccounts?.group ?? group,
          liquidityVault: opts.overrideInferAccounts?.liquidityVault,
        },
        { amount: uiToNative(amount, bank.mintDecimals) },
        remainingAccounts
      )
    : await instructions.makeDepositIx(
        program,
        {
          marginfiAccount: accountAddress,
          signerTokenAccount: userTokenAtaPk,
          bank: bank.address,
          tokenProgram: tokenProgram,
          authority: opts.overrideInferAccounts?.authority ?? authority,
          group: opts.overrideInferAccounts?.group ?? group,
          liquidityVault: opts.overrideInferAccounts?.liquidityVault,
        },
        { amount: uiToNative(amount, bank.mintDecimals) },
        remainingAccounts
      );
  depositIxs.push(depositIx);

  return {
    instructions: depositIxs,
    keys: [],
  };
}

/**
 * Creates a complete deposit transaction ready to be signed and sent.
 *
 * This function builds a full transaction that includes:
 * - SOL wrapping instructions if depositing native SOL
 * - The actual deposit instruction to the Marginfi bank
 * - Proper support for Token-2022 tokens
 *
 * The transaction is constructed as a legacy Transaction with proper metadata
 * and is ready to be signed by the authority and submitted to the network.
 *
 * @param params - The parameters for creating the deposit transaction
 * @param params.luts - Address lookup tables for transaction compression
 * @param params.program - The Marginfi program instance
 * @param params.bank - The bank to deposit into
 * @param params.tokenProgram - The token program ID (TOKEN_PROGRAM or TOKEN_2022_PROGRAM)
 * @param params.amount - The amount to deposit in UI units
 * @param params.accountAddress - The Marginfi account address
 * @param params.authority - The authority/signer public key
 * @param params.group - The Marginfi group address
 * @param params.opts - Optional configuration (wrapping, overrides, etc.)
 *
 * @returns Promise resolving to an ExtendedTransaction with metadata
 */
export async function makeDepositTx(params: MakeDepositTxParams): Promise<ExtendedTransaction> {
  const { luts, ...depositIxParams } = params;

  const ixs = await makeDepositIx(depositIxParams);
  const tx = new Transaction().add(...ixs.instructions);
  tx.feePayer = params.authority;

  const solanaTx = addTransactionMetadata(tx, {
    type: TransactionType.DEPOSIT,
    signers: ixs.keys,
    addressLookupTables: luts,
  });
  return solanaTx;
}
