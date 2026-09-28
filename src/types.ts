import type { Address, ReadonlyUint8Array } from "@solana/kit";

import { Bank } from "./models/bank";
import { OraclePrice } from "./services";
import { DriftStates, JupLendStates, KaminoStates } from "./vendor";

// Define MintData here to break circular dependencies
export type MintData = {
  mint: Address;
  tokenProgram: Address;
  // deprecated
  emissionTokenProgram?: Address | null;
};

export interface BankMetadata {
  validatorVoteAccount?: string;
  tokenAddress: string;
  tokenName: string;
  tokenSymbol: string;
}

/**
 * Supported config environments.
 */
export type Environment = "production" | "staging" | "staging-mainnet-clone" | "staging-alt";

export interface Project0Config {
  environment: Environment;
  programId: Address;
  groupPk: Address;
}

export interface BankAddress {
  label: string;
  address: Address;
}

// --- On-chain account structs

export enum AccountType {
  MarginfiGroup = "marginfiGroup",
  MarginfiAccount = "marginfiAccount",
  Bank = "bank",
}

export type BankIntegrationMetadata = {
  kaminoStates?: KaminoStates;
  driftStates?: DriftStates;
  jupLendStates?: JupLendStates;
};

export type BankIntegrationMetadataMap = {
  [address: string]: BankIntegrationMetadata;
};
export type BankMap = Map<string, Bank>;
export type OraclePriceMap = Map<string, OraclePrice>;
export type MintDataMap = Map<string, MintData>;

export interface WrappedI80F48 {
  /** 16 little-endian bytes of an I80F48 fixed-point number */
  value: ReadonlyUint8Array;
}

export type Amount = BigNumber | number | string;

export type AmountType = "uiToken" | "cToken";

export type TypedAmount = {
  value: Amount;
  type: AmountType;
};

export function resolveAmount(amount: Amount | TypedAmount): { value: Amount; type: AmountType } {
  if (typeof amount === "object" && amount !== null && "type" in amount && "value" in amount) {
    return amount;
  }
  return { value: amount as Amount, type: "uiToken" };
}
