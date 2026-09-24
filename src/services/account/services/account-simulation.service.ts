import {
  address,
  compileTransaction,
  createNoopSigner,
  getBase64Encoder,
  type Address,
  type GetLatestBlockhashApi,
  type Rpc,
} from "@solana/kit";
import { getSetComputeUnitLimitInstruction } from "@solana-program/compute-budget";
import { getTransferSolInstruction } from "@solana-program/system";
import BigNumber from "bignumber.js";

import { makePulseHealthIx } from "../actions/account-lifecycle";
import {
  HealthCacheSimulationError,
  HealthCacheStatus,
  MarginfiAccountRaw,
  MarginfiAccountType,
  MarginRequirementType,
} from "../types";
import { computeHealthComponentsFromBalances } from "../utils/compute/health-compute.utils";
import { parseMarginfiAccountRaw } from "../utils/deserialize.utils";

import { decodeMarginfiAccount } from "~/accounts";
import { AssetTag, BankType } from "~/services/bank/types";
import { makeUpdateJupLendRateIxs, OraclePrice } from "~/services/price";
import { makeTransactionMessage, simulateBundle } from "~/services/transaction";
import { BankIntegrationMetadataMap } from "~/types";
import { bigNumberToWrappedI80F48, wrappedI80F48toBigNumber } from "~/utils";
import { makeUpdateSpotMarketCumulativeInterestIx } from "~/vendor/drift";
import { makeRefreshReservesBatchIx } from "~/vendor/klend";

// Funds the authority so the simulated txs can pay fees; signatures aren't verified.
const MARGINFI_SOL_VAULT = address("DD3AeAssFvjqTvRTrRAtpfjkBF8FpVKnFuwnMLN9haXD");

/**
 * Configuration for simulating account health cache with fallback
 */
export interface SimulateAccountHealthCacheWithFallbackParams {
  /** RPC client, for the blockhash */
  rpc: Rpc<GetLatestBlockhashApi>;
  /** RPC endpoint supporting `simulateBundle` */
  rpcEndpoint: string;
  /** The marginfi program address */
  programAddress: Address;
  /** Map of banks by their address */
  banksMap: Map<string, BankType>;
  /** Map of oracle prices by bank address */
  oraclePricesByBank: Map<string, OraclePrice>;
  /** The marginfi account to simulate health cache for */
  marginfiAccount: MarginfiAccountType;
  /** Bank integration metadata map (for Kamino, Drift, etc.) */
  bankIntegrationMap: BankIntegrationMetadataMap;
  /** Asset share value multipliers by bank address (for integrated protocols) */
  assetShareValueMultiplierByBank?: Map<string, BigNumber>;
  /** Optional emode weight overrides by bank address */
  activeEmodeWeightsByBank?: Map<
    string,
    {
      assetWeightMaint: BigNumber;
      assetWeightInit: BigNumber;
    }
  >;
}

/**
 * Simulates the health cache for a marginfi account with fallback computation.
 *
 * This function attempts to simulate the on-chain health cache calculation, which provides
 * accurate health metrics for the account. If simulation fails (e.g., due to RPC issues),
 * it falls back to computing health components locally.
 *
 * **Primary Method (Simulation):**
 * - Simulates on-chain health pulse instruction
 * - Returns the health cache as it would exist on-chain
 * - Most accurate but requires RPC simulation support
 *
 * **Fallback Method (Computation):**
 * - Computes health components locally using balance data
 * - Calculates Initial, Maintenance, and Equity values
 * - Used when simulation fails or is unavailable
 *
 * **Health Cache Values:**
 * - **Initial**: For opening new positions (most conservative)
 * - **Maintenance**: For liquidation threshold
 * - **Equity**: Actual account value (no risk weighting)
 *
 * @param params - Configuration object for health cache simulation
 * @returns Promise resolving to account with updated health cache and optional error
 *
 * @example
 * ```typescript
 * const { marginfiAccount, error } = await simulateAccountHealthCacheWithFallback({
 *   rpc: client.rpc,
 *   rpcEndpoint: client.rpcEndpoint,
 *   programAddress: client.programAddress,
 *   bankMap: client.bankMap,
 *   oraclePrices: client.oraclePriceByBank,
 *   marginfiAccount: account,
 *   bankMetadataMap: client.bankIntegrationMap,
 *   assetShareValueMultiplierByBank: client.assetShareMultiplierByBank,
 * });
 *
 * if (error) {
 *   console.warn("Simulation failed, using computed values:", error);
 * }
 *
 * console.log("Health:", marginfiAccount.healthCache);
 * ```
 */
export async function simulateAccountHealthCacheWithFallback(
  params: SimulateAccountHealthCacheWithFallbackParams
): Promise<{
  marginfiAccount: MarginfiAccountType;
  error?: HealthCacheSimulationError;
}> {
  const {
    rpc,
    rpcEndpoint,
    programAddress,
    banksMap,
    oraclePricesByBank,
    bankIntegrationMap,
    assetShareValueMultiplierByBank,
    activeEmodeWeightsByBank,
  } = params;

  let marginfiAccount = params.marginfiAccount;

  const activeBalances = marginfiAccount.balances.filter((b) => b.active);

  // Equity health-cache values mirror the program (biased + time-weighted price), matching
  // computeHealthCacheStatus. Not the UI "neutral value" helper.
  const { assets: assetValueEquity, liabilities: liabilityValueEquity } =
    computeHealthComponentsFromBalances({
      activeBalances,
      banksMap,
      oraclePricesByBank,
      marginRequirement: MarginRequirementType.Equity,
      assetShareValueMultiplierByBank,
      activeEmodeWeightsByBank,
    });

  try {
    const simulatedAccount = await simulateAccountHealthCache({
      rpc,
      rpcEndpoint,
      programAddress,
      banksMap,
      marginfiAccount,
      bankIntegrationMap,
    });

    marginfiAccount = parseMarginfiAccountRaw(params.marginfiAccount.address, {
      ...simulatedAccount,
      healthCache: {
        ...simulatedAccount.healthCache,
        assetValueEquity: bigNumberToWrappedI80F48(assetValueEquity),
        liabilityValueEquity: bigNumberToWrappedI80F48(liabilityValueEquity),
      },
    });
  } catch (e) {
    console.log("e", e);
    const { assets: assetValueMaint, liabilities: liabilityValueMaint } =
      computeHealthComponentsFromBalances({
        activeBalances,
        banksMap,
        oraclePricesByBank,
        marginRequirement: MarginRequirementType.Maintenance,
        assetShareValueMultiplierByBank,
        activeEmodeWeightsByBank,
      });

    const { assets: assetValueInitial, liabilities: liabilityValueInitial } =
      computeHealthComponentsFromBalances({
        activeBalances,
        banksMap,
        oraclePricesByBank,
        marginRequirement: MarginRequirementType.Initial,
        assetShareValueMultiplierByBank,
        activeEmodeWeightsByBank,
      });

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

export async function simulateAccountHealthCache(params: {
  rpc: Rpc<GetLatestBlockhashApi>;
  rpcEndpoint: string;
  programAddress: Address;
  banksMap: Map<string, BankType>;
  marginfiAccount: MarginfiAccountType;
  bankIntegrationMap?: BankIntegrationMetadataMap;
}): Promise<MarginfiAccountRaw> {
  const { rpc, rpcEndpoint, programAddress, banksMap, marginfiAccount, bankIntegrationMap } =
    params;

  const activeBalances = marginfiAccount.balances.filter((b) => b.active);

  const activeBanks = activeBalances
    .map((balance) => banksMap.get(balance.bankPk))
    .filter((bank): bank is NonNullable<typeof bank> => !!bank);

  const kaminoBanks = activeBanks.filter((bank) => bank.config.assetTag === AssetTag.KAMINO);

  const driftBanks = activeBanks.filter((bank) => bank.config.assetTag === AssetTag.DRIFT);

  const computeIx = getSetComputeUnitLimitInstruction({ units: 1_400_000 });
  const { value: latestBlockhash } = await rpc
    .getLatestBlockhash({ commitment: "confirmed" })
    .send();
  const authority = createNoopSigner(marginfiAccount.authority);

  const fundAccountIx = getTransferSolInstruction({
    source: createNoopSigner(MARGINFI_SOL_VAULT),
    destination: marginfiAccount.authority,
    amount: 100_000_000, // 0.1 SOL
  });

  const updateDriftMarketData = driftBanks
    .map((bank) => {
      const bankMetadata = bankIntegrationMap?.[bank.address];
      if (!bankMetadata?.driftStates) {
        console.error(`Bank metadata for drift bank ${bank.address} not found`);
        return;
      }

      const driftMarket = bankMetadata.driftStates.spotMarketState;
      return driftMarket;
    })
    .filter((state): state is NonNullable<typeof state> => !!state);

  const refreshReserveData = kaminoBanks
    .map((bank) => {
      const bankMetadata = bankIntegrationMap?.[bank.address];
      if (!bankMetadata?.kaminoStates) {
        console.error(`Bank metadata for kamino bank ${bank.address} not found`);
        return;
      }
      if (!bankMetadata?.kaminoStates || !bank.kaminoIntegrationAccounts) {
        console.error(`Integration data for kamino bank ${bank.address} not found`);
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
    refreshReservesIxs.push(makeRefreshReservesBatchIx(refreshReserveData));
  }

  const updateDriftMarketIxs = await Promise.all(
    updateDriftMarketData.map(makeUpdateSpotMarketCumulativeInterestIx)
  );

  const updateJupLendRateIxs = makeUpdateJupLendRateIxs(
    marginfiAccount,
    banksMap,
    [],
    bankIntegrationMap ?? {}
  );

  const healthPulseIxs = await makePulseHealthIx(
    programAddress,
    marginfiAccount,
    banksMap,
    activeBalances.map((b) => b.bankPk),
    []
  );

  const additionalTx = makeTransactionMessage({
    instructions: [
      computeIx,
      fundAccountIx,
      ...refreshReservesIxs,
      ...updateDriftMarketIxs,
      ...updateJupLendRateIxs,
    ],
    feePayer: authority,
    latestBlockhash,
  });

  const healthTx = makeTransactionMessage({
    instructions: [computeIx, ...healthPulseIxs],
    feePayer: authority,
    latestBlockhash,
  });

  const simulationResult = await simulateBundle(
    rpcEndpoint,
    [compileTransaction(additionalTx), compileTransaction(healthTx)],
    [marginfiAccount.address]
  );

  const postExecutionAccount = simulationResult.find(
    (result) => result.postExecutionAccounts.length > 0
  );

  if (!postExecutionAccount) {
    throw new Error("Account not found");
  }

  const marginfiAccountPost = decodeMarginfiAccount(
    getBase64Encoder().encode(postExecutionAccount.postExecutionAccounts[0].data[0])
  );

  if (marginfiAccountPost.healthCache.mrgnErr || marginfiAccountPost.healthCache.internalErr) {
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
