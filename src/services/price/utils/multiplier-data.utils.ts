import { PublicKey } from "@solana/web3.js";
import BigNumber from "bignumber.js";

import {
  MultiplierAccountState,
  MultiplierAccountStates,
  OracleMultiplierBankInput,
} from "../types";

import { BankType, OracleSetup } from "~/services/bank";
import { decodeExponentVault, ExponentVault } from "~/vendor/exponent";
import { decodeMarinadeState } from "~/vendor/marinade";
import { decodeStakePool } from "~/vendor/spl-stake-pool";

const PT_MAX_MATURITY_HORIZON_SECONDS = 5 * 365 * 24 * 60 * 60;
// u64::MAX / 1e12, the largest SY exchange rate the program can represent
const MAX_SY_EXCHANGE_RATE = new BigNumber("18446744073709551615").div(1e12);
// Same staleness slack as the program: one epoch of crank lag is tolerated
const MAX_STAKE_POOL_EPOCH_LAG = 1;

type PtVaultFields = Pick<
  ExponentVault,
  | "startTs"
  | "duration"
  | "syForPt"
  | "ptSupply"
  | "lastSeenSyExchangeRate"
  | "allTimeHighSyExchangeRate"
>;

// ─── Bank → input ────────────────────────────────────────────

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
 * Builds the multiplier input for a bank, or undefined when the bank is not multiplier-priced.
 */
export function getOracleMultiplierBankInput(
  bank: BankType
): OracleMultiplierBankInput | undefined {
  const accountKey = multiplierAccountKey(bank);
  if (!accountKey) return undefined;

  const isPt =
    bank.config.oracleSetup === OracleSetup.PTPyth ||
    bank.config.oracleSetup === OracleSetup.PTFixed;

  return {
    bankAddress: bank.address.toBase58(),
    oracleSetup: bank.config.oracleSetup,
    multiplierAccountKey: accountKey.toBase58(),
    fixedPrice: isPt ? bank.config.fixedPrice : undefined,
  };
}

// ─── Account decoding ────────────────────────────────────────

/**
 * Decodes a multiplier account without knowing its type up front: Exponent vault (Anchor
 * discriminator), then Marinade state (discriminator), then SPL stake pool (account-type byte).
 * Returns undefined when none match.
 */
export function decodeMultiplierAccount(data: Buffer): MultiplierAccountState | undefined {
  try {
    const vault = decodeExponentVault(data);
    return {
      kind: "exponentVault",
      startTs: vault.startTs,
      duration: vault.duration,
      syForPt: vault.syForPt.toString(),
      ptSupply: vault.ptSupply.toString(),
      lastSeenSyExchangeRate: vault.lastSeenSyExchangeRate.toString(),
      allTimeHighSyExchangeRate: vault.allTimeHighSyExchangeRate.toString(),
    };
  } catch {
    // not an Exponent vault
  }
  try {
    return { kind: "marinade", msolPrice: decodeMarinadeState(data).msolPrice.toString() };
  } catch {
    // not a Marinade state
  }
  try {
    const pool = decodeStakePool(data);
    return {
      kind: "stakePool",
      exchangeRate: pool.exchangeRate.toString(),
      lastUpdateEpoch: pool.lastUpdateEpoch,
    };
  } catch {
    // not a stake pool
  }
  return undefined;
}

// ─── Multiplier computation ──────────────────────────────────

/**
 * PT linear rate: accretion from the bank's fixed_price (start price) to par (1.0) over the
 * vault's [startTs, startTs + duration], clamped at both ends, then capped by the redemption
 * backing so an under-backed vault cannot mark above what its PT redeems for. Mirrors the
 * program's `pt_linear_multiplier`.
 */
export function computePtMultiplier(
  vault: PtVaultFields,
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
 * The multiplier for one bank given its decoded multiplier account. Throws when the account
 * type does not match the bank's oracle setup or the rate is unusable.
 */
export function computeOracleMultiplier(
  input: OracleMultiplierBankInput,
  state: MultiplierAccountState,
  ctx: { currentEpoch: number; nowSeconds: number }
): number {
  switch (input.oracleSetup) {
    case OracleSetup.PythMSOL:
    case OracleSetup.KaminoMSOL:
    case OracleSetup.JuplendMSOL:
      if (state.kind !== "marinade") throw new Error(`Expected Marinade state, got ${state.kind}`);
      return Number(state.msolPrice);

    case OracleSetup.PythLST:
    case OracleSetup.KaminoLST:
    case OracleSetup.JuplendLST:
      if (state.kind !== "stakePool") throw new Error(`Expected stake pool, got ${state.kind}`);
      // Same staleness rule as the program: an uncranked pool one epoch behind is fine,
      // anything older is unpriceable
      if (ctx.currentEpoch - state.lastUpdateEpoch > MAX_STAKE_POOL_EPOCH_LAG) {
        throw new Error(
          `Stale stake pool (last updated epoch ${state.lastUpdateEpoch}, current ${ctx.currentEpoch})`
        );
      }
      return Number(state.exchangeRate);

    case OracleSetup.PTPyth:
    case OracleSetup.PTFixed:
      if (state.kind !== "exponentVault") {
        throw new Error(`Expected Exponent vault, got ${state.kind}`);
      }
      if (!input.fixedPrice) throw new Error("Missing fixedPrice for PT bank");
      return computePtMultiplier(
        {
          startTs: state.startTs,
          duration: state.duration,
          syForPt: BigInt(state.syForPt),
          ptSupply: BigInt(state.ptSupply),
          lastSeenSyExchangeRate: new BigNumber(state.lastSeenSyExchangeRate),
          allTimeHighSyExchangeRate: new BigNumber(state.allTimeHighSyExchangeRate),
        },
        input.fixedPrice,
        ctx.nowSeconds
      ).toNumber();

    default:
      throw new Error(`Oracle setup ${input.oracleSetup} is not multiplier-priced`);
  }
}

/**
 * Maps decoded multiplier accounts back onto banks. Banks whose account is missing or unusable
 * are left out (and end up unpriced downstream).
 */
export function computeOracleMultipliers(
  inputs: OracleMultiplierBankInput[],
  accountStates: MultiplierAccountStates,
  nowSeconds: number = Math.floor(Date.now() / 1000)
): Record<string, number> {
  const multiplierByBank: Record<string, number> = {};
  const ctx = { currentEpoch: accountStates.currentEpoch, nowSeconds };

  for (const input of inputs) {
    const state = accountStates.states[input.multiplierAccountKey];
    if (!state) {
      console.error(`Missing multiplier account for bank ${input.bankAddress}`);
      continue;
    }
    try {
      multiplierByBank[input.bankAddress] = computeOracleMultiplier(input, state, ctx);
    } catch (e) {
      console.error(`Failed to compute multiplier for bank ${input.bankAddress}`, e);
    }
  }

  return multiplierByBank;
}
