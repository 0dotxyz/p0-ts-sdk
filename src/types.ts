import { PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";
import { Program as AnchorProgram, AnchorProvider, Idl } from "@coral-xyz/anchor";

import { MarginfiIdlType } from "./idl";
import { Bank } from "./models/bank";
import { OraclePrice } from "./services";
import {
  DriftRewards,
  DriftRewardsJSON,
  DriftSpotMarket,
  DriftSpotMarketJSON,
  DriftUser,
  DriftUserJSON,
  DriftUserStats,
  DriftUserStatsJSON,
  FarmStateJSON,
  FarmStateRaw,
  ObligationJSON,
  ObligationRaw,
  ReserveJSON,
  ReserveRaw,
} from "./vendor";

// Define MintData here to break circular dependencies
export type MintData = {
  mint: PublicKey;
  tokenProgram: PublicKey;
  // deprecated
  emissionTokenProgram?: PublicKey | null;
};

export type Program<T extends Idl> = Omit<AnchorProgram<T>, "provider"> & {
  provider: AnchorProvider;
};

export type MarginfiProgram = Program<MarginfiIdlType>;

export type Wallet = {
  publicKey: PublicKey;
  signTransaction<T extends Transaction | VersionedTransaction>(transaction: T): Promise<T>;
  signAllTransactions<T extends Transaction | VersionedTransaction>(
    transactions: T[]
  ): Promise<T[]>;
  signMessage?: (message: Uint8Array) => Promise<Uint8Array>;
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
  programId: PublicKey;
  groupPk: PublicKey;
}

export interface BankAddress {
  label: string;
  address: PublicKey;
}

// --- On-chain account structs

export enum AccountType {
  MarginfiGroup = "marginfiGroup",
  MarginfiAccount = "marginfiAccount",
  Bank = "bank",
}

export type KaminoStates = {
  reserveState: ReserveRaw;
  obligationState: ObligationRaw;
  farmState?: FarmStateRaw;
};

export type BankIntegrationMetadata = {
  kaminoStates?: {
    reserveState: ReserveRaw;
    obligationState: ObligationRaw;
    farmState?: FarmStateRaw;
  };
  driftStates?: {
    spotMarketState: DriftSpotMarket;
    userState: DriftUser;
    userRewards: DriftRewards[];
    userStatsState?: DriftUserStats;
  };
};

export type BankIntegrationMetadataDto = {
  kaminoStates?: {
    reserveState: ReserveJSON;
    obligationState: ObligationJSON;
    farmState?: FarmStateJSON;
  };
  driftStates?: {
    spotMarketState: DriftSpotMarketJSON;
    userState: DriftUserJSON;
    userRewards: DriftRewardsJSON[];
    userStatsState?: DriftUserStatsJSON;
  };
};

export type BankIntegrationMetadataMap = {
  [address: string]: BankIntegrationMetadata;
};
export type BankIntegrationMetadataMapDto = {
  [address: string]: BankIntegrationMetadataDto;
};
export type BankMap = Map<string, Bank>;
export type OraclePriceMap = Map<string, OraclePrice>;
export type MintDataMap = Map<string, MintData>;

export interface WrappedI80F48 {
  value: number[];
}

export type Amount = BigNumber | number | string;
