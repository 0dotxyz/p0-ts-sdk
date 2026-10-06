import { PublicKey } from "@solana/web3.js";
import BigNumber from "bignumber.js";

export interface BalanceType {
  active: boolean;
  bankPk: PublicKey;
  /**
   * Tag used by orders to reference this balance (0 means unused/unassigned).
   * A tag may be non-zero even when no order currently references it.
   */
  tag: number;
  assetShares: BigNumber;
  liabilityShares: BigNumber;
  /** Stored premium APR snapshot (0.05 = 5%): the rate premium accrues at until the next refresh. */
  premiumRate: BigNumber;
  /** Premium already accrued into the balance, in native units of the bank's mint. */
  premiumOutstanding: BigNumber;
  lastUpdate: number;
}

export enum HealthCacheFlags {
  /**
   * If set (1), the account is considered healthy and cannot be liquidated.
   * If not set (0), the account is unhealthy and can be liquidated.
   */
  HEALTHY = 1 << 0, // 1
  /**
   * If set (1), the engine did not error during the last health pulse.
   * If not set (0), the engine would have errored and this cache is likely invalid.
   * `RiskEngineInitRejected` is ignored and will allow the flag to be set anyways.
   */
  ENGINE_STATUS_OK = 1 << 1, // 2
  /**
   * If set (1), the engine did not error due to an oracle issue.
   * If not set (0), engine was passed a bad bank or oracle account, or an oracle was stale.
   * Check the order in which accounts were passed and ensure each balance has the correct banks/oracles,
   * and that oracle cranks ran recently enough. Check `internal_err` and `err_index` for more details
   * in some circumstances. Invalid if generated after borrow/withdraw (these instructions will
   * ignore oracle issues if health is still satisfactory with some balance zeroed out).
   */
  ORACLE_OK = 1 << 2, // 4
}

export enum HealthCacheStatus {
  UNSET,
  ONCHAIN,
  COMPUTED,
}

export interface HealthCacheType {
  assetValue: BigNumber;
  liabilityValue: BigNumber;
  assetValueMaint: BigNumber;
  liabilityValueMaint: BigNumber;
  assetValueEquity: BigNumber;
  liabilityValueEquity: BigNumber;
  timestamp: BigNumber;
  flags: HealthCacheFlags[];
  prices: number[][];
  simulationStatus: HealthCacheStatus;
}

export interface MarginfiAccountType {
  address: PublicKey;
  group: PublicKey;
  authority: PublicKey;
  balances: BalanceType[];
  accountFlags: AccountFlags[];
  emissionsDestinationAccount: PublicKey;
  healthCache: HealthCacheType;
  /** Orders that point at this account, including orphaned ones. Transfer requires 0. */
  activeOrders: number;
}

export enum AccountFlags {
  ACCOUNT_DISABLED = 1 << 0, // 1
  ACCOUNT_IN_FLASHLOAN = 1 << 1, // 2
  ACCOUNT_FLAG_DEPRECATED = 1 << 2, // 4
  ACCOUNT_TRANSFER_AUTHORITY_ALLOWED = 1 << 3, // 8
  ACCOUNT_IN_RECEIVERSHIP = 1 << 4, // 16
  ACCOUNT_IN_DELEVERAGE = 1 << 5, // 32
  ACCOUNT_FROZEN = 1 << 6, // 64
  ACCOUNT_IN_ORDER_EXECUTION = 1 << 7, // 128
}

export enum MarginRequirementType {
  Initial = 0,
  Maintenance = 1,
  Equity = 2,
}

export type OrderTriggerKind = "stopLoss" | "takeProfit" | "both";

export interface OrderType {
  address: PublicKey;
  marginfiAccount: PublicKey;
  /** Which trigger(s) this order fires on. */
  trigger: OrderTriggerKind;
  /** Pair net-equity stop-loss threshold in USD, null when the order has no stop-loss leg. */
  stopLoss: BigNumber | null;
  /** Pair net-equity take-profit threshold in USD, null when the order has no take-profit leg. */
  takeProfit: BigNumber | null;
  /** Tags linking this order to its two balances (see {@link BalanceType.tag}). */
  tags: [number, number];
  /** Unix timestamp (seconds) when the order was created. */
  createdAt: number;
  /** Max slippage the keeper may impose on execution, in percent. */
  maxSlippagePercent: number;
}
