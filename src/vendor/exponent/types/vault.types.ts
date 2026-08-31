import { BigNumber } from "bignumber.js";
import { PublicKey } from "@solana/web3.js";

import { ExponentMarketTwoCpiAccounts } from "./market.types";

/** The subset of Exponent's `Vault` account that `merge` / the roll needs. */
export interface ExponentVault {
  /** Vault signer authority (`merge.authority`, via `has_one = authority`). */
  authority: PublicKey;
  syProgram: PublicKey;
  mintSy: PublicKey;
  mintYt: PublicKey;
  mintPt: PublicKey;
  escrowSy: PublicKey;
  yieldPosition: PublicKey;
  addressLookupTable: PublicKey;
  /**
   * SY-program CPI account lists (referenced by ALT index). `merge` appends
   * `get_sy_state ++ withdraw_sy` as remaining accounts.
   */
  cpiAccounts: ExponentMarketTwoCpiAccounts;
  /**
   * Total SY backing all PT (native u64). The PT→SY redemption rate is
   * `sy_for_pt / pt_supply` (Exponent's `Vault::pt_redemption_rate`).
   */
  syForPt: bigint;
  /** Total PT supply (native u64). */
  ptSupply: bigint;
  /** Last-seen SY exchange rate (underlying per SY), scaled by 1e12 → BigNumber. Sizes `strip`. */
  lastSeenSyExchangeRate: BigNumber;
  /** Final (maturity) SY exchange rate, already scaled by 1e12 → BigNumber (informational). */
  finalSyExchangeRate: BigNumber;
  /** Raw status byte. */
  status: number;
  /** Vault start timestamp (unix seconds); maturity = `startTs + duration`. */
  startTs: number;
  /** Vault duration in seconds. */
  duration: number;
}
