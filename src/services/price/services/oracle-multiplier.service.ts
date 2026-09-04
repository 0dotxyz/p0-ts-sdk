import { Connection, PublicKey } from "@solana/web3.js";
import BigNumber from "bignumber.js";

import { BankType, OracleSetup } from "~/services/bank";
import { chunkedGetRawMultipleAccountInfoOrderedWithNulls } from "~/services/misc";
import { decodeExponentVault, ExponentVault } from "~/vendor/exponent";
import { decodeMarinadeState } from "~/vendor/marinade";
import { decodeStakePool } from "~/vendor/spl-stake-pool";

type FetchOracleMultiplierOnChainOpts = {
  mode: "on-chain";
  connection: Connection;
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

const PT_MAX_MATURITY_HORIZON_SECONDS = 5 * 365 * 24 * 60 * 60;
// u64::MAX / 1e12, the largest SY exchange rate the program can represent
const MAX_SY_EXCHANGE_RATE = new BigNumber("18446744073709551615").div(1e12);
// Same staleness slack as the program: one epoch of crank lag is tolerated
const MAX_STAKE_POOL_EPOCH_LAG = 1;

/**
 * The account holding the exchange rate for a multiplier-priced bank. Venue variants carry their
 * reserve/lending account in oracleKeys[1], pushing the pricing account to oracleKeys[2].
 */
function multiplierAccountKey(bank: BankType): PublicKey | undefined {
  switch (bank.config.oracleSetup) {
    case OracleSetup.PythMSOL:
    case OracleSetup.PythLST:
    case OracleSetup.PTPyth:
      return bank.config.oracleKeys[1];
    case OracleSetup.KaminoMSOL:
    case OracleSetup.JuplendMSOL:
    case OracleSetup.KaminoLST:
    case OracleSetup.JuplendLST:
      return bank.config.oracleKeys[2];
    case OracleSetup.PTFixed:
      return bank.config.oracleKeys[0];
    default:
      return undefined;
  }
}

/**
 * PT linear rate: accretion from the bank's fixed_price (start price) to par (1.0) over the
 * vault's [startTs, startTs + duration], clamped at both ends, then capped by the redemption
 * backing so an under-backed vault cannot mark above what its PT redeems for. Mirrors the
 * program's `pt_linear_multiplier`.
 */
export function computePtMultiplier(
  vault: ExponentVault,
  startPrice: BigNumber,
  nowSeconds: number
): BigNumber {
  const maturity = vault.startTs + vault.duration;

  // Mirror the program's rejection of malformed vaults: the schedule must be a real forward
  // window (<= ~5 years out) and the SY exchange rate a positive in-range u64.
  if (vault.duration <= 0 || maturity > nowSeconds + PT_MAX_MATURITY_HORIZON_SECONDS) {
    throw new Error("Exponent vault has an invalid maturity schedule");
  }
  if (
    !vault.lastSeenSyExchangeRate.gt(0) ||
    vault.lastSeenSyExchangeRate.gt(MAX_SY_EXCHANGE_RATE)
  ) {
    throw new Error("Exponent vault SY exchange rate out of bounds");
  }
  if (vault.ptSupply === 0n) {
    throw new Error("Exponent vault has zero PT supply");
  }
  // The program refuses to price a vault in emergency mode (SY rate fell below its all-time high).
  if (vault.lastSeenSyExchangeRate.lt(vault.allTimeHighSyExchangeRate)) {
    throw new Error("Exponent vault is in emergency mode");
  }

  let expectedRate: BigNumber;
  if (nowSeconds <= vault.startTs) {
    expectedRate = startPrice;
  } else if (nowSeconds >= maturity) {
    expectedRate = new BigNumber(1);
  } else {
    const progress = new BigNumber(nowSeconds - vault.startTs).div(vault.duration);
    expectedRate = startPrice.plus(new BigNumber(1).minus(startPrice).times(progress));
  }

  const syPerPt = new BigNumber(vault.syForPt.toString()).div(
    new BigNumber(vault.ptSupply.toString())
  );
  const redemptionCap = syPerPt.times(vault.lastSeenSyExchangeRate);

  return BigNumber.min(expectedRate, redemptionCap);
}

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
  const multipliedBanks = banks.filter((bank) => multiplierAccountKey(bank) !== undefined);

  if (!multipliedBanks.length) {
    return {};
  }

  if (!opts) {
    console.warn(
      `fetchOracleMultipliers: no oracleMultiplierOpts provided; ${multipliedBanks.length} multiplier-priced bank(s) will have zero prices`
    );
    return {};
  }

  if (opts.mode === "api") {
    return fetchOracleMultipliersFromAPI(
      multipliedBanks.map((bank) => bank.address.toBase58()),
      opts.multiplierData.endpoint,
      { queryKey: opts.multiplierData.queryKey }
    );
  }

  return fetchOracleMultipliersFromChain(multipliedBanks, opts.connection);
};

/**
 * Fetches price multipliers via internal API endpoint
 * @param bankAddresses - Array of bank addresses in base58 format
 * @param apiEndpoint - Fetches multipliers with a GET request using the bank addresses as params
 * @returns Promise resolving to multipliers indexed by bank address
 */
export const fetchOracleMultipliersFromAPI = async (
  bankAddresses: string[],
  apiEndpoint: string,
  opts?: { queryKey?: string }
): Promise<Record<string, number>> => {
  const queryKey = opts?.queryKey ?? "bankAddresses";
  const response = await fetch(`${apiEndpoint}?${queryKey}=${bankAddresses.join(",")}`);

  if (!response.ok) {
    throw new Error("Failed to fetch price multiplier data");
  }

  const { data } = (await response.json()) as { data: Record<string, string> };

  return Object.fromEntries(
    Object.entries(data)
      .map(([bankAddress, multiplier]) => [bankAddress, Number(multiplier)] as [string, number])
      .filter(([, multiplier]) => Number.isFinite(multiplier))
  );
};

/**
 * Computes price multipliers directly from the blockchain via RPC connection
 * @param multipliedBanks - Array of multiplier-priced bank objects
 * @param connection - Solana RPC connection instance
 * @returns Promise resolving to multipliers indexed by bank address
 */
export const fetchOracleMultipliersFromChain = async (
  multipliedBanks: BankType[],
  connection: Connection
): Promise<Record<string, number>> => {
  const accountKeyByBank = new Map(
    multipliedBanks.map((bank) => [bank.address.toBase58(), multiplierAccountKey(bank)!.toBase58()])
  );
  const uniqueAccountKeys = Array.from(new Set(accountKeyByBank.values()));
  const accountAis = await chunkedGetRawMultipleAccountInfoOrderedWithNulls(
    connection,
    uniqueAccountKeys
  );

  const isLstSetup = (setup: OracleSetup) =>
    setup === OracleSetup.PythLST ||
    setup === OracleSetup.KaminoLST ||
    setup === OracleSetup.JuplendLST;
  const currentEpoch = multipliedBanks.some((bank) => isLstSetup(bank.config.oracleSetup))
    ? (await connection.getEpochInfo()).epoch
    : 0;

  const accountDataByKey: Record<string, Buffer | undefined> = {};
  uniqueAccountKeys.forEach((accountKey, index) => {
    accountDataByKey[accountKey] = accountAis[index]?.data;
  });

  const multiplierByBank: Record<string, number> = {};
  const nowSeconds = Math.floor(Date.now() / 1000);

  for (const bank of multipliedBanks) {
    const bankAddress = bank.address.toBase58();
    const data = accountDataByKey[accountKeyByBank.get(bankAddress)!];
    if (!data) {
      console.error(`Missing multiplier account for bank ${bankAddress}`);
      continue;
    }

    try {
      switch (bank.config.oracleSetup) {
        case OracleSetup.PythMSOL:
        case OracleSetup.KaminoMSOL:
        case OracleSetup.JuplendMSOL:
          multiplierByBank[bankAddress] = decodeMarinadeState(data).msolPrice.toNumber();
          break;
        case OracleSetup.PythLST:
        case OracleSetup.KaminoLST:
        case OracleSetup.JuplendLST: {
          const stakePool = decodeStakePool(data);
          // Same staleness rule as the program: an uncranked pool one epoch behind is fine,
          // anything older is unpriceable
          if (currentEpoch - stakePool.lastUpdateEpoch > MAX_STAKE_POOL_EPOCH_LAG) {
            console.error(
              `Stale stake pool for bank ${bankAddress} (last updated epoch ${stakePool.lastUpdateEpoch}, current ${currentEpoch})`
            );
            continue;
          }
          multiplierByBank[bankAddress] = stakePool.exchangeRate.toNumber();
          break;
        }
        case OracleSetup.PTPyth:
        case OracleSetup.PTFixed:
          multiplierByBank[bankAddress] = computePtMultiplier(
            decodeExponentVault(data),
            bank.config.fixedPrice,
            nowSeconds
          ).toNumber();
          break;
      }
    } catch (e) {
      console.error(`Failed to compute multiplier for bank ${bankAddress}`, e);
    }
  }

  return multiplierByBank;
};
