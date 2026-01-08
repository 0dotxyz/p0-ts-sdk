import { PublicKey } from "@solana/web3.js";
import { MarginfiIdlType } from "./idl";
import { Program } from "@mrgnlabs/mrgn-common";
import { Bank } from "./models/bank";
import { OraclePrice } from "./services";
import {
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

export type MarginfiProgram = Program<MarginfiIdlType>;

/**
 * Supported config environments.
 */
export type Environment =
  | "production"
  | "staging"
  | "staging-mainnet-clone"
  | "staging-alt";

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
};

export type BankIntegrationMetadataDto = {
  kaminoStates?: {
    reserveState: ReserveJSON;
    obligationState: ObligationJSON;
    farmState?: FarmStateJSON;
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
