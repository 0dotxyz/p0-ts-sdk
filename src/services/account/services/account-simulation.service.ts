import {
  AddressLookupTableAccount,
  ComputeBudgetProgram,
  Connection,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import BigNumber from "bignumber.js";

import { BankIntegrationMetadataMap, MarginfiProgram } from "~/types";
import { AssetTag, BankType, OracleSetup } from "~/services/bank";
import { makeCrankSwbFeedIx, makeUpdateSwbFeedIx, OraclePrice } from "~/services/price";
import klendInstructions from "~/vendor/klend/instructions";
import { DriftSpotMarket, makeUpdateSpotMarketIx } from "~/vendor/drift";
import {
  addTransactionMetadata,
  simulateBundle,
  SolanaTransaction,
  TransactionType,
} from "~/services/transaction";
import { ZERO_ORACLE_KEY } from "~/constants";
import { bigNumberToWrappedI80F48, wrappedI80F48toBigNumber } from "~/utils";

import {
  BalanceType,
  HealthCacheSimulationError,
  HealthCacheStatus,
  MarginfiAccountRaw,
  MarginfiAccountType,
  MarginRequirementType,
} from "../types";
import {
  decodeAccountRaw,
  parseMarginfiAccountRaw,
  computeHealthComponentsLegacy,
  computeHealthComponentsWithoutBiasLegacy,
} from "../utils";
import { makePulseHealthIx } from "../actions";

export async function simulateAccountHealthCacheWithFallback(props: {
  program: MarginfiProgram;
  bankMap: Map<string, BankType>;
  oraclePrices: Map<string, OraclePrice>;
  marginfiAccount: MarginfiAccountType;
  bankMetadataMap: BankIntegrationMetadataMap;
}): Promise<{
  marginfiAccount: MarginfiAccountType;
  error?: HealthCacheSimulationError;
}> {
  let marginfiAccount = props.marginfiAccount;

  const activeBalances = marginfiAccount.balances.filter((b) => b.active);

  const { assets: assetValueEquity, liabilities: liabilityValueEquity } =
    computeHealthComponentsWithoutBiasLegacy(
      activeBalances,
      props.bankMap,
      props.oraclePrices,
      MarginRequirementType.Equity
    );

  try {
    const simulatedAccount = await simulateAccountHealthCache({
      program: props.program,
      bankMap: props.bankMap,
      marginfiAccount: props.marginfiAccount,
      bankMetadataMap: props.bankMetadataMap,
    });

    simulatedAccount.healthCache.assetValueEquity = bigNumberToWrappedI80F48(assetValueEquity);
    simulatedAccount.healthCache.liabilityValueEquity =
      bigNumberToWrappedI80F48(liabilityValueEquity);

    marginfiAccount = parseMarginfiAccountRaw(props.marginfiAccount.address, simulatedAccount);
  } catch (e) {
    console.log("e", e);
    const { assets: assetValueMaint, liabilities: liabilityValueMaint } =
      computeHealthComponentsLegacy(
        activeBalances,
        props.bankMap,
        props.oraclePrices,
        MarginRequirementType.Maintenance,
        []
      );

    const { assets: assetValueInitial, liabilities: liabilityValueInitial } =
      computeHealthComponentsLegacy(
        activeBalances,
        props.bankMap,
        props.oraclePrices,
        MarginRequirementType.Initial,
        []
      );

    marginfiAccount.healthCache = {
      assetValue: assetValueInitial,
      liabilityValue: liabilityValueInitial,
      assetValueMaint: assetValueMaint,
      liabilityValueMaint: liabilityValueMaint,
      assetValueEquity: assetValueEquity,
      liabilityValueEquity: liabilityValueEquity,
      timestamp: new BigNumber(0),
      flags: [],
      prices: [],
      simulationStatus: HealthCacheStatus.COMPUTED,
    };

    // Return the error if it's a HealthCacheSimulationError
    if (e instanceof HealthCacheSimulationError) {
      return { marginfiAccount, error: e };
    }
  }

  return { marginfiAccount };
}

export async function simulateAccountHealthCache(props: {
  program: MarginfiProgram;
  bankMap: Map<string, BankType>;
  marginfiAccount: MarginfiAccountType;
  bankMetadataMap?: BankIntegrationMetadataMap;
}): Promise<MarginfiAccountRaw> {
  const { program, bankMap, marginfiAccount, bankMetadataMap } = props;

  const activeBalances = marginfiAccount.balances.filter((b) => b.active);

  // this will always return swb oracles regardless of staleness
  // stale functionality should be re-added once we increase amount of swb oracles
  const activeBanks = activeBalances
    .map((balance) => bankMap.get(balance.bankPk.toBase58()))
    .filter((bank): bank is NonNullable<typeof bank> => !!bank);

  const kaminoBanks = activeBanks.filter((bank) => bank.config.assetTag === AssetTag.KAMINO);

  const driftBanks = activeBanks.filter((bank) => bank.config.assetTag === AssetTag.DRIFT);

  const staleSwbOracles = activeBanks
    .filter(
      (bank) =>
        bank.config.oracleSetup === OracleSetup.SwitchboardPull ||
        bank.config.oracleSetup === OracleSetup.SwitchboardV2 ||
        bank.config.oracleSetup === OracleSetup.KaminoSwitchboardPull ||
        bank.config.oracleSetup === OracleSetup.DriftSwitchboardPull ||
        bank.config.oracleSetup === OracleSetup.SolendSwitchboardPull
    )
    .filter((bank) => !bank.oracleKey.equals(new PublicKey(ZERO_ORACLE_KEY)));

  const computeIx = ComputeBudgetProgram.setComputeUnitLimit({
    units: 1_400_000,
  });
  const blockhash = (await program.provider.connection.getLatestBlockhash("confirmed")).blockhash;

  const fundAccountIx = SystemProgram.transfer({
    fromPubkey: new PublicKey("DD3AeAssFvjqTvRTrRAtpfjkBF8FpVKnFuwnMLN9haXD"), // marginfi SOL VAULT
    toPubkey: marginfiAccount.authority,
    lamports: 100_000_000, // 0.1 SOL
  });

  const updateDriftMarketData = driftBanks
    .map((bank) => {
      const bankMetadata = bankMetadataMap?.[bank.address.toBase58()];
      if (!bankMetadata?.driftStates) {
        console.error(`Bank metadata for drift bank ${bank.address.toBase58()} not found`);
        return;
      }

      const driftMarket = bankMetadata.driftStates.spotMarketState;
      return driftMarket;
    })
    .filter((state): state is NonNullable<typeof state> => !!state);

  const refreshReserveData = kaminoBanks
    .map((bank) => {
      const bankMetadata = bankMetadataMap?.[bank.address.toBase58()];
      if (!bankMetadata?.kaminoStates) {
        console.error(`Bank metadata for kamino bank ${bank.address.toBase58()} not found`);
        return;
      }
      if (!bankMetadata?.kaminoStates || !bank.kaminoIntegrationAccounts) {
        console.error(`Integration data for kamino bank ${bank.address.toBase58()} not found`);
        return;
      }

      const kaminoReserve = bank.kaminoIntegrationAccounts.kaminoReserve;
      const lendingMarket = bankMetadata.kaminoStates.reserveState.lendingMarket;

      return {
        reserve: kaminoReserve,
        lendingMarket,
      };
    })
    .filter((bank): bank is NonNullable<typeof bank> => !!bank);

  const refreshReservesIxs = [];
  if (refreshReserveData.length > 0) {
    const refreshIx = klendInstructions.makeRefreshReservesBatchIx(refreshReserveData);
    refreshReservesIxs.push(refreshIx);
  }

  const crankSwbIxs =
    staleSwbOracles.length > 0
      ? await makeUpdateSwbFeedIx({
          swbPullOracles: staleSwbOracles.map((oracle) => ({
            key: oracle.oracleKey,
          })),
          feePayer: marginfiAccount.authority,
          connection: program.provider.connection,
        })
      : { instructions: [], luts: [] };

  const updateDriftMarketIxs = updateDriftMarketData.map((market) => ({
    ix: makeUpdateSpotMarketIx({
      spotMarket: market,
    }),
  }));

  const healthPulseIxs = await makePulseHealthIx(
    program,
    marginfiAccount.address,
    bankMap,
    marginfiAccount.balances,
    activeBalances.map((b) => b.bankPk),
    []
  );

  const txs = [];

  const additionalTx = new VersionedTransaction(
    new TransactionMessage({
      payerKey: marginfiAccount.authority,
      recentBlockhash: blockhash,
      instructions: [
        computeIx,
        fundAccountIx,
        ...refreshReservesIxs,
        ...updateDriftMarketIxs.map((ix) => ix.ix),
      ],
    }).compileToV0Message()
  );

  txs.push(additionalTx);

  const swbTx = new VersionedTransaction(
    new TransactionMessage({
      payerKey: marginfiAccount.authority,
      recentBlockhash: blockhash,
      instructions: [...crankSwbIxs.instructions],
    }).compileToV0Message([...crankSwbIxs.luts])
  );

  txs.push(swbTx);

  const healthTx = new VersionedTransaction(
    new TransactionMessage({
      payerKey: marginfiAccount.authority,
      recentBlockhash: blockhash,
      instructions: [computeIx, ...healthPulseIxs.instructions],
    }).compileToV0Message([])
  );

  txs.push(healthTx);

  if (txs.length > 5) {
    console.error("Too many transactions", txs.length);
    throw new Error("Too many transactions");
  }

  const simulationResult = await simulateBundle(program.provider.connection.rpcEndpoint, txs, [
    marginfiAccount.address,
  ]);

  const postExecutionAccount = simulationResult.find(
    (result) => result.postExecutionAccounts.length > 0
  );

  if (!postExecutionAccount) {
    throw new Error("Account not found");
  }

  const marginfiAccountPost = decodeAccountRaw(
    Buffer.from(postExecutionAccount.postExecutionAccounts[0].data[0], "base64"),
    program.idl
  );

  if (marginfiAccountPost.healthCache.mrgnErr || marginfiAccountPost.healthCache.internalErr) {
    console.log(
      "cranked swb oracles",
      staleSwbOracles.map((oracle) => oracle.oracleKey)
    );
    console.log(
      "MarginfiAccountPost healthCache internalErr",
      marginfiAccountPost.healthCache.internalErr
    );
    console.log("MarginfiAccountPost healthCache mrgnErr", marginfiAccountPost.healthCache.mrgnErr);

    if (marginfiAccountPost.healthCache.mrgnErr === 6009) {
      const assetValue = !wrappedI80F48toBigNumber(
        marginfiAccountPost.healthCache.assetValue
      ).isZero();
      const liabilityValue = !wrappedI80F48toBigNumber(
        marginfiAccountPost.healthCache.liabilityValue
      ).isZero();
      const assetValueEquity = !wrappedI80F48toBigNumber(
        marginfiAccountPost.healthCache.assetValueEquity
      ).isZero();
      const liabilityValueEquity = !wrappedI80F48toBigNumber(
        marginfiAccountPost.healthCache.liabilityValueEquity
      ).isZero();
      const assetValueMaint = !wrappedI80F48toBigNumber(
        marginfiAccountPost.healthCache.assetValueMaint
      ).isZero();
      const liabilityValueMaint = !wrappedI80F48toBigNumber(
        marginfiAccountPost.healthCache.liabilityValueMaint
      ).isZero();

      if (
        assetValue &&
        liabilityValue &&
        assetValueEquity &&
        liabilityValueEquity &&
        assetValueMaint &&
        liabilityValueMaint
      ) {
        return marginfiAccountPost;
      }
    }
    console.error("Account health cache simulation failed", {
      mrgnErr: marginfiAccountPost.healthCache.mrgnErr,
      internalErr: marginfiAccountPost.healthCache.internalErr,
    });
    throw new HealthCacheSimulationError(
      "Account health cache simulation failed",
      marginfiAccountPost.healthCache.mrgnErr,
      marginfiAccountPost.healthCache.internalErr
    );
  }

  return marginfiAccountPost;
}

export async function getHealthSimulationTransactions({
  connection,
  projectedActiveBanks,
  bankMap,
  bankMetadataMap,
  marginfiAccount,
  program,
  authority,
  luts,
  includeCrankTx,
  blockhash,
}: {
  connection: Connection;
  projectedActiveBanks: PublicKey[];
  bankMap: Map<string, BankType>;
  bankMetadataMap: BankIntegrationMetadataMap;
  marginfiAccount: MarginfiAccountType;
  program: MarginfiProgram;
  authority: PublicKey;
  luts: AddressLookupTableAccount[];
  includeCrankTx: boolean;
  blockhash: string;
}) {
  const additionalTxs: SolanaTransaction[] = [];

  const computeIx = ComputeBudgetProgram.setComputeUnitLimit({
    units: 1_400_000,
  });

  let updateFeedIx: {
    instructions: TransactionInstruction[];
    luts: AddressLookupTableAccount[];
  } | null = null;

  if (includeCrankTx) {
    updateFeedIx = await makeCrankSwbFeedIx(
      marginfiAccount,
      bankMap,
      projectedActiveBanks,
      program.provider
    );
  }

  const activeBanks: PublicKey[] = marginfiAccount.balances
    .filter((b) => b.active)
    .map((b) => b.bankPk);

  // Convert to string sets for easier comparison
  const activeBankStrings = new Set(activeBanks.map((pk) => pk.toString()));
  const projectedActiveBankStrings = new Set(projectedActiveBanks.map((pk) => pk.toString()));

  // if active bank is not in projectedActiveBanks, it should be excluded
  const excludedBanks: PublicKey[] = activeBanks.filter(
    (pk) => !projectedActiveBankStrings.has(pk.toString())
  );

  // if projectedActiveBanks is not in activeBanks, it should be added
  const mandatoryBanks: PublicKey[] = projectedActiveBanks.filter(
    (pk) => !activeBankStrings.has(pk.toString())
  );

  // todo only refresh reserves if not present
  const refreshReserveData: { reserve: PublicKey; lendingMarket: PublicKey }[] = [];
  const updateDriftMarketData: DriftSpotMarket[] = [];

  projectedActiveBanks.forEach((bankPk) => {
    const bankMetadata = bankMetadataMap?.[bankPk.toBase58()];
    const bank = bankMap.get(bankPk.toBase58());

    if (!bank) {
      console.error(`Bank ${bankPk.toBase58()} not found in bankMap`);
      return;
    }

    if (!bankMetadata) {
      console.error(`Bank metadata not found for bank ${bankPk.toBase58()}`);
      return;
    }

    switch (bank.config.assetTag) {
      case AssetTag.KAMINO:
        if (!bankMetadata.kaminoStates || !bank.kaminoIntegrationAccounts) {
          console.error(
            `Bank ${bankPk.toBase58()} is missing kamino states or integration accounts`
          );
          return;
        }
        const kaminoReserve = bank.kaminoIntegrationAccounts.kaminoReserve;
        const lendingMarket = bankMetadata.kaminoStates.reserveState.lendingMarket;

        refreshReserveData.push({
          reserve: kaminoReserve,
          lendingMarket,
        });
        break;
      case AssetTag.DRIFT:
        if (!bankMetadata?.driftStates) {
          console.error(`Bank metadata for drift bank ${bank.address.toBase58()} not found`);
          return;
        }
        const driftMarket = bankMetadata.driftStates.spotMarketState;
        updateDriftMarketData.push(driftMarket);

        break;

      case AssetTag.SOLEND:
        break;

      default:
        break;
    }
  });

  const refreshReservesIx: TransactionInstruction[] = [];
  if (refreshReserveData.length > 0) {
    const refreshIx = klendInstructions.makeRefreshReservesBatchIx(refreshReserveData);
    refreshReservesIx.push(refreshIx);
  }

  const updateDriftMarketIxs = updateDriftMarketData.map((market) => ({
    ix: makeUpdateSpotMarketIx({
      spotMarket: market,
    }),
  }));

  const healthPulseIx = await makePulseHealthIx(
    program,
    marginfiAccount.address,
    bankMap,
    marginfiAccount.balances,
    mandatoryBanks,
    excludedBanks
  );

  const refreshReservesTx = new VersionedTransaction(
    new TransactionMessage({
      instructions: [computeIx, ...refreshReservesIx, ...updateDriftMarketIxs.map((ix) => ix.ix)],
      payerKey: authority,
      recentBlockhash: blockhash,
    }).compileToV0Message([...luts])
  );

  additionalTxs.push(
    addTransactionMetadata(refreshReservesTx, {
      type: TransactionType.CRANK,
      signers: [],
      addressLookupTables: luts,
    })
  );

  const healthCrankTx = new VersionedTransaction(
    new TransactionMessage({
      instructions: [computeIx, ...healthPulseIx.instructions],
      payerKey: authority,
      recentBlockhash: blockhash,
    }).compileToV0Message([...luts])
  );

  if (updateFeedIx) {
    const oracleCrankTx = new VersionedTransaction(
      new TransactionMessage({
        instructions: [...updateFeedIx.instructions],
        payerKey: authority,
        recentBlockhash: blockhash,
      }).compileToV0Message([...updateFeedIx.luts])
    );

    additionalTxs.push(
      addTransactionMetadata(oracleCrankTx, {
        type: TransactionType.CRANK,
        signers: [],
        addressLookupTables: updateFeedIx.luts,
      })
    );
  }

  additionalTxs.push(
    addTransactionMetadata(healthCrankTx, {
      type: TransactionType.CRANK,
      signers: [],
      addressLookupTables: luts,
    })
  );

  return additionalTxs;
}
