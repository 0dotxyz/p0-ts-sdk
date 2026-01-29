import {
  AddressLookupTableAccount,
  Connection,
  PublicKey,
  Signer,
  TransactionInstruction,
} from "@solana/web3.js";
import { ConfigurationParameters } from "@jup-ag/api";

import { ReserveRaw } from "~/vendor/klend";
import { DriftRewards, DriftSpotMarket } from "~/vendor/drift";
import { BankType } from "~/services/bank";
import { OraclePrice } from "~/services/price";
import { SolanaTransaction } from "~/services/transaction";
import { Amount, BankIntegrationMetadataMap, MarginfiProgram } from "~/types";

import { MarginfiAccountType } from "./account.types";

export interface MakeDepositIxOpts {
  wrapAndUnwrapSol?: boolean;
  wSolBalanceUi?: number;
  overrideInferAccounts?: {
    group?: PublicKey;
    authority?: PublicKey;
    liquidityVault?: PublicKey;
  };
}

export interface MakeDepositIxParams {
  program: MarginfiProgram;
  bank: BankType;
  tokenProgram: PublicKey;
  amount: Amount;
  accountAddress: PublicKey;
  authority: PublicKey;
  group: PublicKey;
  isSync?: boolean;
  opts?: MakeDepositIxOpts;
}

export interface MakeDriftDepositIxParams {
  program: MarginfiProgram;
  bank: BankType;
  tokenProgram: PublicKey;
  amount: Amount;
  accountAddress: PublicKey;
  authority: PublicKey;
  group: PublicKey;
  driftOracle: PublicKey;
  driftMarketIndex: number;
  isSync?: boolean;
  opts?: MakeDepositIxOpts;
}

export interface MakeKaminoDepositIxParams {
  program: MarginfiProgram;
  bank: BankType;
  tokenProgram: PublicKey;
  amount: Amount;
  accountAddress: PublicKey;
  authority: PublicKey;
  group: PublicKey;
  reserve: ReserveRaw;
  isSync?: boolean;
  opts?: MakeDepositIxOpts;
}

export interface MakeDepositTxParams extends MakeDepositIxParams {
  luts: AddressLookupTableAccount[];
  blockhash?: string;
}

export interface MakeDriftDepositTxParams extends MakeDriftDepositIxParams {
  luts: AddressLookupTableAccount[];
  connection: Connection;
  blockhash?: string;
}

export interface MakeKaminoDepositTxParams extends MakeKaminoDepositIxParams {
  luts: AddressLookupTableAccount[];
  connection: Connection;
  blockhash?: string;
}

export interface MakeRepayIxOpts {
  wrapAndUnwrapSol?: boolean;
  wSolBalanceUi?: number;
  overrideInferAccounts?: {
    group?: PublicKey;
    authority?: PublicKey;
    liquidityVault?: PublicKey;
  };
}

export interface MakeRepayIxParams {
  program: MarginfiProgram;
  bank: BankType;
  tokenProgram: PublicKey;
  amount: Amount;
  accountAddress: PublicKey;
  authority: PublicKey;
  repayAll?: boolean;
  isSync?: boolean;
  opts?: MakeRepayIxOpts;
}

export interface MakeRepayTxParams extends MakeRepayIxParams {
  luts: AddressLookupTableAccount[];
}

export interface MakeWithdrawIxOpts {
  observationBanksOverride?: PublicKey[];
  wrapAndUnwrapSol?: boolean;
  createAtas?: boolean;
  overrideInferAccounts?: {
    group?: PublicKey;
    authority?: PublicKey;
  };
}

export interface MakeDriftWithdrawIxParams {
  program: MarginfiProgram;
  bank: BankType;
  bankMap: Map<string, BankType>;
  tokenProgram: PublicKey;
  amount: Amount;
  marginfiAccount: MarginfiAccountType;
  authority: PublicKey;
  driftSpotMarket: DriftSpotMarket;
  userRewards: DriftRewards[];
  bankMetadataMap: BankIntegrationMetadataMap;
  isSync?: boolean;
  withdrawAll?: boolean;
  opts?: MakeWithdrawIxOpts;
}

export interface MakeKaminoWithdrawIxParams {
  program: MarginfiProgram;
  bank: BankType;
  bankMap: Map<string, BankType>;
  tokenProgram: PublicKey;
  amount: Amount;
  marginfiAccount: MarginfiAccountType;
  authority: PublicKey;
  reserve: ReserveRaw;
  bankMetadataMap: BankIntegrationMetadataMap;
  isSync?: boolean;
  withdrawAll?: boolean;
  opts?: MakeWithdrawIxOpts;
}

export interface MakeWithdrawIxParams {
  program: MarginfiProgram;
  bank: BankType;
  bankMap: Map<string, BankType>;
  tokenProgram: PublicKey;
  amount: Amount;
  marginfiAccount: MarginfiAccountType;
  authority: PublicKey;
  bankMetadataMap: BankIntegrationMetadataMap;
  isSync?: boolean;
  withdrawAll?: boolean;
  opts?: MakeWithdrawIxOpts;
}

export interface MakeWithdrawTxParams extends MakeWithdrawIxParams {
  connection: Connection;
  oraclePrices: Map<string, OraclePrice>;
  luts: AddressLookupTableAccount[];
  crossbarUrl?: string;
}

export interface MakeKaminoWithdrawTxParams extends MakeKaminoWithdrawIxParams {
  connection: Connection;
  oraclePrices: Map<string, OraclePrice>;
  luts: AddressLookupTableAccount[];
  crossbarUrl?: string;
}

export interface MakeBorrowIxOpts {
  observationBanksOverride?: PublicKey[];
  wrapAndUnwrapSol?: boolean;
  createAtas?: boolean;
  overrideInferAccounts?: {
    group?: PublicKey;
    authority?: PublicKey;
  };
}

export interface MakeBorrowIxParams {
  program: MarginfiProgram;
  bank: BankType;
  bankMap: Map<string, BankType>;
  tokenProgram: PublicKey;
  amount: Amount;
  marginfiAccount: MarginfiAccountType;
  authority: PublicKey;
  isSync?: boolean;
  opts?: MakeBorrowIxOpts;
}

export interface MakeBorrowTxParams extends MakeBorrowIxParams {
  connection: Connection;
  oraclePrices: Map<string, OraclePrice>;
  bankMetadataMap: BankIntegrationMetadataMap;
  luts: AddressLookupTableAccount[];
  crossbarUrl?: string;
}

export interface MakeDriftWithdrawTxParams extends MakeDriftWithdrawIxParams {
  connection: Connection;
  oraclePrices: Map<string, OraclePrice>;
  luts: AddressLookupTableAccount[];
  crossbarUrl?: string;
}

export interface MakeCloseAccountIxParams {
  program: MarginfiProgram;
  marginfiAccount: MarginfiAccountType;
  authority: PublicKey;
}

export interface MakeCloseAccountTxParams extends MakeCloseAccountIxParams {
  connection: Connection;
}

export interface TransactionBuilderResult {
  transactions: SolanaTransaction[];
  actionTxIndex: number;
}

export interface FlashloanActionResult extends TransactionBuilderResult {
  /** Whether transaction size exceeds limits */
  txOverflown: boolean;
}

export interface MakeFlashLoanTxParams {
  program: MarginfiProgram;
  marginfiAccount: MarginfiAccountType;
  bankMap: Map<string, BankType>;
  ixs: TransactionInstruction[];
  blockhash: string;
  addressLookupTableAccounts?: AddressLookupTableAccount[];
  isSync?: boolean;
  signers?: Signer[];
}

export interface MakeLoopTxParams {
  program: MarginfiProgram;
  marginfiAccount: MarginfiAccountType;
  connection: Connection;
  bankMap: Map<string, BankType>;
  oraclePrices: Map<string, OraclePrice>;
  bankMetadataMap: BankIntegrationMetadataMap;
  depositOpts: {
    // if deposit looping, this principal amount will be added
    inputDepositAmount: number;
    depositBank: BankType;
    tokenProgram: PublicKey;
    loopMode: "DEPOSIT" | "BORROW";
  };
  borrowOpts: {
    borrowAmount: number;
    borrowBank: BankType;
    tokenProgram: PublicKey;
  };
  swapOpts: {
    jupiterOptions?: {
      slippageMode: "DYNAMIC" | "FIXED";
      slippageBps: number;
      platformFeeBps: number;
      directRoutesOnly?: boolean;
      configParams?: ConfigurationParameters;
    };
    // if swapIxs is provided, it will be used instead of creating instructions
    swapIxs?: {
      instructions: TransactionInstruction[];
      lookupTables: AddressLookupTableAccount[];
    };
  };
  addressLookupTableAccounts?: AddressLookupTableAccount[];
  overrideInferAccounts?: {
    group?: PublicKey;
    authority?: PublicKey;
  };
  additionalIxs?: TransactionInstruction[];
  crossbarUrl?: string;
}

export interface MakeRepayWithCollatTxParams {
  program: MarginfiProgram;
  marginfiAccount: MarginfiAccountType;
  connection: Connection;
  bankMap: Map<string, BankType>;
  oraclePrices: Map<string, OraclePrice>;
  bankMetadataMap: BankIntegrationMetadataMap;
  withdrawOpts: {
    // Amount of the total position
    totalPositionAmount: number;
    // Amount to withdraw to pay for debt
    withdrawAmount: number;
    withdrawBank: BankType;
    tokenProgram: PublicKey;
  };
  repayOpts: {
    repayBank: BankType;
    tokenProgram: PublicKey;
    // Amount of the total position use to determine max repay amount
    totalPositionAmount: number;
    // if repayAmount is provided, it will be used instead of jupiter swap output
    repayAmount?: number;
  };
  swapOpts: {
    jupiterOptions?: {
      slippageMode: "DYNAMIC" | "FIXED";
      slippageBps: number;
      platformFeeBps: number;
      directRoutesOnly?: boolean;
      configParams?: ConfigurationParameters;
    };
    // if swapIxs is provided, it will be used instead of creating instructions
    swapIxs?: {
      instructions: TransactionInstruction[];
      lookupTables: AddressLookupTableAccount[];
    };
  };
  addressLookupTableAccounts?: AddressLookupTableAccount[];
  overrideInferAccounts?: {
    group?: PublicKey;
    authority?: PublicKey;
  };
  additionalIxs?: TransactionInstruction[];
  crossbarUrl?: string;
}

export interface MakeSwapCollateralTxParams {
  program: MarginfiProgram;
  marginfiAccount: MarginfiAccountType;
  connection: Connection;
  bankMap: Map<string, BankType>;
  oraclePrices: Map<string, OraclePrice>;
  bankMetadataMap: BankIntegrationMetadataMap;
  withdrawOpts: {
    // Amount of the total position
    totalPositionAmount: number;
    withdrawBank: BankType;
    tokenProgram: PublicKey;
  };
  depositOpts: {
    depositBank: BankType;
    tokenProgram: PublicKey;
  };
  swapOpts: {
    jupiterOptions?: {
      slippageMode: "DYNAMIC" | "FIXED";
      slippageBps: number;
      platformFeeBps: number;
      directRoutesOnly?: boolean;
    };
  };
  addressLookupTableAccounts?: AddressLookupTableAccount[];
  overrideInferAccounts?: {
    group?: PublicKey;
    authority?: PublicKey;
  };
  additionalIxs?: TransactionInstruction[];
  crossbarUrl?: string;
}

export interface MakeSetupIxParams {
  connection: Connection;
  authority: PublicKey;
  tokens: {
    mint: PublicKey;
    tokenProgram: PublicKey;
  }[];
}
