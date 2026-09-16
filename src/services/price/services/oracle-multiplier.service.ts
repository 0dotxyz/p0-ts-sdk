import {
  MultiplierAccountState,
  MultiplierAccountStates,
  OracleMultiplierBankInput,
} from "../types";
import {
  computeOracleMultipliers,
  decodeMultiplierAccount,
  getOracleMultiplierBankInput,
} from "../utils";

import { BankType } from "~/services/bank";
import { chunkedGetRawMultipleAccountInfoOrderedWithNulls } from "~/services/misc";
import type { SolanaRpc } from "~/types";

type FetchOracleMultiplierOnChainOpts = {
  mode: "on-chain";
  connection: SolanaRpc;
};

type FetchOracleMultiplierApiOpts = {
  mode: "api";
  multiplierData: {
    endpoint: string;
    queryKey?: string;
  };
};

export type OracleMultiplierServiceOpts =
  | FetchOracleMultiplierOnChainOpts
  | FetchOracleMultiplierApiOpts;

/**
 * Fetches the exchange-rate multipliers for banks priced as `base feed x on-chain rate`
 * (Marinade mSOL rate, SPL stake-pool LST rate, Exponent PT linear rate)
 * @param banks - Array of bank objects
 * @param opts - Configuration including API endpoint usage and connection
 * @returns Promise resolving to multipliers indexed by bank address
 */
export const fetchOracleMultipliers = async (
  banks: BankType[],
  opts?: OracleMultiplierServiceOpts
): Promise<Record<string, number>> => {
  const inputs = banks
    .map(getOracleMultiplierBankInput)
    .filter((input): input is OracleMultiplierBankInput => input !== undefined);

  if (!inputs.length) {
    return {};
  }

  if (!opts) {
    console.warn(
      `fetchOracleMultipliers: no oracleMultiplierOpts provided; ${inputs.length} multiplier-priced bank(s) will have zero prices`
    );
    return {};
  }

  if (opts.mode === "api") {
    return fetchOracleMultipliersFromAPI(inputs, opts.multiplierData.endpoint, {
      queryKey: opts.multiplierData.queryKey,
    });
  }

  return fetchOracleMultipliersFromChain(inputs, opts.connection);
};

/**
 * Multipliers for the given banks, reading the accounts via the internal API endpoint.
 */
export const fetchOracleMultipliersFromAPI = async (
  inputs: OracleMultiplierBankInput[],
  apiEndpoint: string,
  opts?: { queryKey?: string }
): Promise<Record<string, number>> => {
  const accountStates = await fetchMultiplierAccountStatesFromAPI(
    inputs.map((input) => input.multiplierAccountKey),
    apiEndpoint,
    opts
  );
  return computeOracleMultipliers(inputs, accountStates);
};

/**
 * Multipliers for the given banks, reading the accounts directly from the chain.
 */
export const fetchOracleMultipliersFromChain = async (
  inputs: OracleMultiplierBankInput[],
  connection: SolanaRpc
): Promise<Record<string, number>> => {
  const accountStates = await fetchMultiplierAccountStates(
    inputs.map((input) => input.multiplierAccountKey),
    connection
  );
  return computeOracleMultipliers(inputs, accountStates);
};

/**
 * Reads multiplier accounts via an internal API endpoint that runs `fetchMultiplierAccountStates`
 * server-side and returns `{ data: MultiplierAccountStates }`.
 * @param accountKeys - Multiplier account addresses (base58)
 * @param apiEndpoint - GET endpoint
 * @param opts.queryKey - Name of the account-list param (default `multiplierAccounts`)
 */
export const fetchMultiplierAccountStatesFromAPI = async (
  accountKeys: string[],
  apiEndpoint: string,
  opts?: { queryKey?: string }
): Promise<MultiplierAccountStates> => {
  const queryKey = opts?.queryKey ?? "multiplierAccounts";
  const uniqueKeys = Array.from(new Set(accountKeys));
  const response = await fetch(`${apiEndpoint}?${queryKey}=${uniqueKeys.join(",")}`);

  if (!response.ok) {
    throw new Error("Failed to fetch price multiplier data");
  }

  const { data } = (await response.json()) as { data: MultiplierAccountStates };
  return data;
};

/**
 * Reads and decodes multiplier accounts from the chain.
 * @param accountKeys - Multiplier account addresses (base58)
 * @param connection - Solana RPC connection instance
 */
export const fetchMultiplierAccountStates = async (
  accountKeys: string[],
  connection: SolanaRpc
): Promise<MultiplierAccountStates> => {
  const uniqueKeys = Array.from(new Set(accountKeys));
  const accountAis = await chunkedGetRawMultipleAccountInfoOrderedWithNulls(connection, uniqueKeys);

  const states: Record<string, MultiplierAccountState> = {};
  uniqueKeys.forEach((accountKey, index) => {
    const data = accountAis[index]?.data;
    if (!data) {
      console.error(`Missing multiplier account ${accountKey}`);
      return;
    }
    const state = decodeMultiplierAccount(data);
    if (!state) {
      console.error(`Unrecognized multiplier account ${accountKey}`);
      return;
    }
    states[accountKey] = state;
  });

  const hasStakePool = Object.values(states).some((state) => state.kind === "stakePool");
  const currentEpoch = hasStakePool ? (await connection.getEpochInfo()).epoch : 0;

  return { states, currentEpoch };
};
