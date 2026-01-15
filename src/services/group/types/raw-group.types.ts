import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";

// ----------------------------------------------------------------------------
// On-chain types
// ----------------------------------------------------------------------------

/**
 * Fee state cache - stores information from the global FeeState
 * so the FeeState can be omitted on certain instructions
 * 
 * Note: This matches the actual deserialized structure from Anchor
 */
interface FeeStateCache {
  globalFeeWallet: PublicKey;
  programFeeFixed: { value: number[] };
  programFeeRate: { value: number[] };
  lastUpdate: BN;
}

/**
 * Panic state cache - stores information about temporary panic mode
 * 
 * Note: This matches the actual deserialized structure from Anchor
 */
interface PanicStateCache {
  pauseFlags: number;
  reserved: number[];
  pauseStartTimestamp: BN;
  lastCacheUpdate: BN;
}

/**
 * Withdraw window cache - tracks liquidity withdrawn from the group
 * over a day as protection against large unwanted withdrawals
 * 
 * Note: This matches the actual deserialized structure from Anchor
 */
interface WithdrawWindowCache {
  dailyLimit: number;
  withdrawnToday: number;
  lastDailyResetTimestamp: BN;
}

/**
 * MarginfiGroup on-chain account structure
 */
interface MarginfiGroupRaw {
  /** Broadly able to modify anything, and can set/remove other admins at will */
  admin: PublicKey;

  /**
   * Bitmask for group settings flags:
   * - Bit 0: PROGRAM_FEES_ENABLED - If set, program-level fees are enabled
   * - Bit 1: ARENA_GROUP - If set, this is an arena group (can only have two banks)
   * - Bits 2-63: Reserved for future use
   */
  groupFlags: BN;

  /**
   * Caches information from the global FeeState so the FeeState
   * can be omitted on certain instructions
   */
  feeStateCache: FeeStateCache;

  /** Number of banks in this group */
  banks: number;

  /** Padding */
  pad0: number[];

  /**
   * This admin can configure collateral ratios above (but not below)
   * the collateral ratio of certain banks, e.g. allow SOL to count as
   * 90% collateral when borrowing an LST instead of the default rate
   */
  emodeAdmin: PublicKey;

  /** Delegate for curve configuration */
  delegateCurveAdmin: PublicKey;

  /**
   * Can modify the deposit_limit, borrow_limit, total_asset_value_init_limit
   * but nothing else, for every bank under this group
   */
  delegateLimitAdmin: PublicKey;

  /**
   * Can modify the emissions flags, emissions_rate and emissions_mint,
   * but nothing else, for every bank under this group
   */
  delegateEmissionsAdmin: PublicKey;

  /**
   * When program keeper temporarily puts the program into panic mode,
   * information about the duration of the lockup will be available here
   */
  panicStateCache: PanicStateCache;

  /**
   * Keeps track of the liquidity withdrawn from the group over the day
   * as a result of deleverages. Used as a protection mechanism against
   * too big (and unwanted) withdrawals (e.g. when the risk admin is compromised)
   */
  deleverageWithdrawWindowCache: WithdrawWindowCache;

  /**
   * Can run bankruptcy and forced deleverage instructions to e.g.
   * sunset risky/illiquid assets
   */
  riskAdmin: PublicKey;

  /** Can modify a Bank's metadata, and nothing else */
  metadataAdmin: PublicKey;

  /** Reserved for future use */
  padding0: BN[][];

  /** Reserved for future use */
  padding1: BN[][];
}

export type {
  MarginfiGroupRaw,
  FeeStateCache,
  PanicStateCache,
  WithdrawWindowCache,
};
