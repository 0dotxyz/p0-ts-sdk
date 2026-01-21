import {
  PublicKey,
  TransactionInstruction,
  AddressLookupTableAccount,
  VersionedTransaction,
  TransactionMessage,
} from "@solana/web3.js";
import { BigNumber } from "bignumber.js";

import { deriveUserState, FARMS_PROGRAM_ID, getAllDerivedKaminoAccounts } from "~/vendor/klend";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
  NATIVE_MINT,
  TOKEN_2022_PROGRAM_ID,
} from "~/vendor/spl";
import { getAllDerivedDriftAccounts } from "~/vendor/drift";
import instructions from "~/instructions";
import syncInstructions from "~/sync-instructions";
import {
  addTransactionMetadata,
  ExtendedV0Transaction,
  InstructionsWrapper,
  makeUnwrapSolIx,
  TransactionType,
} from "~/services/transaction";
import {
  makeRefreshKaminoBanksIxs,
  makeSmartCrankSwbFeedIx,
  makeUpdateDriftMarketIxs,
} from "~/services/price";
import { uiToNative } from "~/utils";

import {
  MakeKaminoWithdrawIxParams,
  MakeWithdrawIxParams,
  MakeWithdrawTxParams,
  TransactionBuilderResult,
  MakeKaminoWithdrawTxParams,
  MakeDriftWithdrawTxParams,
  MakeDriftWithdrawIxParams,
} from "../types";
import { computeHealthCheckAccounts, computeHealthAccountMetas } from "../utils";

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
    ? computeHealthCheckAccounts(marginfiAccount.balances, bankMap, [], [bank.address])
    : computeHealthCheckAccounts(marginfiAccount.balances, bankMap, [bank.address], []);

  const marketIndex = driftSpotMarket.marketIndex;
  const driftOracle = driftSpotMarket.oracle;

  const { driftState, driftSigner, driftSpotMarketVault } = getAllDerivedDriftAccounts(marketIndex);

  if (!bank.driftIntegrationAccounts) {
    throw new Error("Bank has no drift integration accounts");
  }

  if (opts.observationBanksOverride) {
    remainingAccounts.push(...opts.observationBanksOverride);
  } else {
    const accountMetas = computeHealthAccountMetas(healthAccounts);
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
      instructions: withdrawIxs.instructions,
      program: params.program,
      connection: params.connection,
      crossbarUrl: params.crossbarUrl,
    });
    updateFeedIxs = _updateFeedIxs;
    feedLuts = _feedLuts;
  }

  const updateDriftMarketIxs = makeUpdateDriftMarketIxs(
    params.marginfiAccount,
    params.bankMap,
    [withdrawIxParams.bank.address],
    params.bankMetadataMap
  );

  const refreshIxs = makeRefreshKaminoBanksIxs(
    params.marginfiAccount,
    params.bankMap,
    [withdrawIxParams.bank.address],
    params.bankMetadataMap
  );

  const {
    value: { blockhash },
  } = await connection.getLatestBlockhashAndContext("confirmed");

  let feedCrankTxs: ExtendedV0Transaction[] = [];

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
        instructions: [
          ...refreshIxs.instructions,
          ...updateDriftMarketIxs.instructions,
          ...withdrawIxs.instructions,
        ],
        payerKey: params.authority,
        recentBlockhash: blockhash,
      }).compileToV0Message(luts)
    ),
    {
      signers: [...refreshIxs.keys, ...withdrawIxs.keys],
      addressLookupTables: luts,
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
  amount,
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
    ? computeHealthCheckAccounts(marginfiAccount.balances, bankMap, [], [bank.address])
    : computeHealthCheckAccounts(marginfiAccount.balances, bankMap, [bank.address], []);

  const lendingMarket = reserve.lendingMarket;

  const {
    lendingMarketAuthority,
    reserveLiquiditySupply,
    reserveCollateralMint,
    reserveDestinationDepositCollateral,
  } = getAllDerivedKaminoAccounts(reserve.lendingMarket, bank.mint);

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
    const accountMetas = computeHealthAccountMetas(healthAccounts);
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
          reserveLiquidityMint: bank.mint,
          reserveLiquiditySupply,
          reserveCollateralMint,

          reserveSourceCollateral: reserveDestinationDepositCollateral,
          liquidityTokenProgram: tokenProgram,

          obligationFarmUserState: userFarmState,
          reserveFarmState: reserveFarm,
        },
        {
          amount: uiToNative(amount, bank.mintDecimals),
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
          reserveLiquidityMint: bank.mint,

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
          amount: uiToNative(amount, bank.mintDecimals),
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
    ? computeHealthCheckAccounts(marginfiAccount.balances, bankMap, [], [bank.address])
    : computeHealthCheckAccounts(marginfiAccount.balances, bankMap, [bank.address], []);

  // Add withdraw-related instructions
  const remainingAccounts: PublicKey[] = [];
  if (tokenProgram.equals(TOKEN_2022_PROGRAM_ID)) {
    remainingAccounts.push(bank.mint);
  }
  if (opts.observationBanksOverride) {
    remainingAccounts.push(...opts.observationBanksOverride);
  } else {
    const accountMetas = computeHealthAccountMetas(healthAccounts);
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
      instructions: withdrawIxs.instructions,
      program: params.program,
      connection: params.connection,
      crossbarUrl: params.crossbarUrl,
    });
    updateFeedIxs = _updateFeedIxs;
    feedLuts = _feedLuts;
  }

  const updateDriftMarketIxs = makeUpdateDriftMarketIxs(
    params.marginfiAccount,
    params.bankMap,
    [withdrawIxParams.bank.address],
    params.bankMetadataMap
  );

  const refreshIxs = makeRefreshKaminoBanksIxs(
    params.marginfiAccount,
    params.bankMap,
    [withdrawIxParams.bank.address],
    params.bankMetadataMap
  );

  const {
    value: { blockhash },
  } = await connection.getLatestBlockhashAndContext("confirmed");

  let feedCrankTxs: ExtendedV0Transaction[] = [];

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
        instructions: [
          ...refreshIxs.instructions,
          ...updateDriftMarketIxs.instructions,
          ...withdrawIxs.instructions,
        ],
        payerKey: params.authority,
        recentBlockhash: blockhash,
      }).compileToV0Message(luts)
    ),
    {
      signers: [...refreshIxs.keys, ...withdrawIxs.keys],
      addressLookupTables: luts,
      type: TransactionType.WITHDRAW,
    }
  );

  const transactions = [...feedCrankTxs, withdrawTx];

  return { transactions, actionTxIndex: transactions.length - 1 };
}

export async function makeKaminoWithdrawTx(
  params: MakeKaminoWithdrawTxParams
): Promise<TransactionBuilderResult> {
  const { luts, connection, amount, ...withdrawIxParams } = params;

  if (!withdrawIxParams.bank.kaminoIntegrationAccounts) {
    throw new Error("Bank has no kamino integration accounts");
  }

  const adjustedAmount = new BigNumber(amount)
    .div(withdrawIxParams.bank.assetShareValue)
    .toNumber();

  const refreshIxs = makeRefreshKaminoBanksIxs(
    params.marginfiAccount,
    params.bankMap,
    [withdrawIxParams.bank.address],
    params.bankMetadataMap
  );

  const updateDriftMarketIxs = makeUpdateDriftMarketIxs(
    params.marginfiAccount,
    params.bankMap,
    [withdrawIxParams.bank.address],
    params.bankMetadataMap
  );

  const withdrawIxs = await makeKaminoWithdrawIx({
    amount: adjustedAmount,
    ...withdrawIxParams,
  });

  const { instructions: updateFeedIxs, luts: feedLuts } = await makeSmartCrankSwbFeedIx({
    marginfiAccount: params.marginfiAccount,
    bankMap: params.bankMap,
    oraclePrices: params.oraclePrices,
    instructions: withdrawIxs.instructions,
    program: params.program,
    connection: params.connection,
    crossbarUrl: params.crossbarUrl,
  });

  const {
    value: { blockhash },
  } = await connection.getLatestBlockhashAndContext("confirmed");

  let feedCrankTxs: ExtendedV0Transaction[] = [];

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
        instructions: [
          ...refreshIxs.instructions,
          ...updateDriftMarketIxs.instructions,
          ...withdrawIxs.instructions,
        ],
        payerKey: params.authority,
        recentBlockhash: blockhash,
      }).compileToV0Message(luts)
    ),
    {
      signers: [...refreshIxs.keys, ...withdrawIxs.keys],
      addressLookupTables: luts,
      type: TransactionType.WITHDRAW,
    }
  );

  const transactions = [...feedCrankTxs, withdrawTx];

  return { transactions, actionTxIndex: transactions.length - 1 };
}
