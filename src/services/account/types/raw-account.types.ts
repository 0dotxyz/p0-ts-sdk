import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";

import { WrappedI80F48 } from "~/types";

// ----------------------------------------------------------------------------
// On-chain types
// ----------------------------------------------------------------------------

export interface BalanceRaw {
  active: boolean | number;
  bankPk: PublicKey;
  tag: number;
  assetShares: WrappedI80F48;
  liabilityShares: WrappedI80F48;
  emissionsOutstanding: WrappedI80F48;
  lastUpdate: BN;
}

export interface HealthCacheRaw {
  assetValue: WrappedI80F48;
  liabilityValue: WrappedI80F48;
  assetValueMaint: WrappedI80F48;
  liabilityValueMaint: WrappedI80F48;
  assetValueEquity: WrappedI80F48;
  liabilityValueEquity: WrappedI80F48;
  timestamp: BN;
  flags: number;
  prices: number[][];

  errIndex: number;
  internalErr: number;
  internalBankruptcyErr: number;
  internalLiqErr: number;
  mrgnErr: number;
}

export interface MarginfiAccountRaw {
  group: PublicKey;
  authority: PublicKey;
  lendingAccount: { balances: BalanceRaw[]; lastTagUsed: number };
  accountFlags: BN;
  emissionsDestinationAccount: PublicKey;
  healthCache: HealthCacheRaw;
  activeOrders: number;
  padding0?: BN[];
}

export type OrderTriggerTypeRaw =
  | { stopLoss: Record<string, never> }
  | { takeProfit: Record<string, never> }
  | { both: Record<string, never> };

export interface OrderRaw {
  marginfiAccount: PublicKey;
  stopLoss: WrappedI80F48;
  takeProfit: WrappedI80F48;
  createdAt: BN;
  maxSlippage: number;
  tags: number[];
  trigger: OrderTriggerTypeRaw;
  bump: number;
}

export type MarginRequirementTypeRaw =
  | { initial: Record<string, never> }
  | { maintenance: Record<string, never> }
  | { equity: Record<string, never> };
