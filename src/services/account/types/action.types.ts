import {
  AddressLookupTableAccount,
  Connection,
  Keypair,
  PublicKey,
  Signer,
  TransactionInstruction,
} from "@solana/web3.js";

import { ReserveRaw } from "~/vendor/klend";
import { DriftRewards, DriftSpotMarket } from "~/vendor/drift";
import { JupLendingState } from "~/vendor/jup-lend";
import type { ExponentMergeAccounts } from "~/vendor/exponent";
import { BankType } from "~/services/bank";
import { OraclePrice } from "~/services/price";
import { SolanaTransaction } from "~/services/transaction";
import { Amount, TypedAmount, BankIntegrationMetadataMap, MarginfiProgram } from "~/types";

import { MarginfiAccountType } from "./account.types";
import type { SwapEngineRunner } from "../services/swap-engine/types";

export enum SwapProvider {
  JUPITER = "JUPITER",
  TITAN = "TITAN",
  DFLOW = "DFLOW",
}

export interface SwapApiConfig {
  basePath?: string;
  /** WebSocket endpoint (e.g. `wss://<host>/api/v1/ws`). Used by the Titan V3
   *  adapter, which sends the full footprint template inline over the socket to
   *  avoid the gateway GET's URL-length limit. */
  wsUrl?: string;
  apiKey?: string;
  headers?: Record<string, string>;
}

export interface SwapProviderEntry {
  provider: SwapProvider;
  apiConfig?: SwapApiConfig;
}

export interface SwapProviderConfig {
  provider: SwapProvider;
  slippageMode: "DYNAMIC" | "FIXED";
  slippageBps: number;
  platformFeeBps: number;
  directRoutesOnly?: boolean;
  apiConfig?: SwapApiConfig;
  fallbackProviders?: SwapProviderEntry[];
}

export interface SwapOpts {
  swapConfig?: SwapProviderConfig;
  // if swapIxs is provided, it will be used instead of creating instructions
  swapIxs?: {
    instructions: TransactionInstruction[];
    lookupTables: AddressLookupTableAccount[];
  };
}

export interface SwapQuoteResult {
  inAmount: string;
  outAmount: string;
  otherAmountThreshold: string;
  slippageBps: number;
  platformFee?: {
    amount: string;
    feeBps: number;
  };
  priceImpactPct?: string;
  contextSlot?: number;
  timeTaken?: number;
  provider?: SwapProvider;
}

export interface SwapIxsResult {
  swapInstructions: TransactionInstruction[];
  setupInstructions: TransactionInstruction[];
  addressLookupTableAddresses: AddressLookupTableAccount[];
  quoteResponse: SwapQuoteResult;
}

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

export interface MakeJuplendDepositIxParams {
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

export interface MakeJuplendDepositTxParams extends MakeJuplendDepositIxParams {
  luts: AddressLookupTableAccount[];
  connection: Connection;
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
  cTokenAmount: Amount;
  marginfiAccount: MarginfiAccountType;
  authority: PublicKey;
  reserve: ReserveRaw;
  bankMetadataMap: BankIntegrationMetadataMap;
  isSync?: boolean;
  withdrawAll?: boolean;
  opts?: MakeWithdrawIxOpts;
}

export interface MakeJuplendWithdrawIxParams {
  program: MarginfiProgram;
  bank: BankType;
  bankMap: Map<string, BankType>;
  tokenProgram: PublicKey;
  amount: Amount;
  marginfiAccount: MarginfiAccountType;
  authority: PublicKey;
  jupLendingState: JupLendingState;
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
  assetShareValueMultiplierByBank: Map<string, BigNumber>;
  luts: AddressLookupTableAccount[];
  crossbarUrl?: string;
}

export interface MakeKaminoWithdrawTxParams extends Omit<
  MakeKaminoWithdrawIxParams,
  "cTokenAmount"
> {
  amount: Amount | TypedAmount;
  connection: Connection;
  oraclePrices: Map<string, OraclePrice>;
  assetShareValueMultiplierByBank: Map<string, BigNumber>;
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
  /**
   * Additional banks to include in the health check calculation.
   * Useful for combined operations where a deposit precedes the borrow
   * and the deposited bank needs to be considered for health calculation.
   */
  additionalHealthCheckBanks?: PublicKey[];
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
  assetShareValueMultiplierByBank: Map<string, BigNumber>;
  bankMetadataMap: BankIntegrationMetadataMap;
  luts: AddressLookupTableAccount[];
  crossbarUrl?: string;
}

export interface MakeJuplendWithdrawTxParams extends MakeJuplendWithdrawIxParams {
  connection: Connection;
  oraclePrices: Map<string, OraclePrice>;
  assetShareValueMultiplierByBank: Map<string, BigNumber>;
  luts: AddressLookupTableAccount[];
  crossbarUrl?: string;
}

export interface MakeDriftWithdrawTxParams extends MakeDriftWithdrawIxParams {
  connection: Connection;
  oraclePrices: Map<string, OraclePrice>;
  assetShareValueMultiplierByBank: Map<string, BigNumber>;
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

export interface MakeAccountTransferToNewAccountTxParams {
  connection: Connection;
  program: MarginfiProgram;
  /** The account being transferred (its current authority is the signer). */
  marginfiAccount: MarginfiAccountType;
  /** Freshly generated keypair for the destination account; must sign. */
  newMarginfiAccount: Signer;
  /** The wallet that will own the new account. */
  newAuthority: PublicKey;
  /** Optional. Pays rent/fees. A `PublicKey` signs via the wallet adapter; a
   *  `Keypair` is a separate fee payer that signs directly. Defaults to the
   *  account's current authority. */
  feePayer?: PublicKey | Keypair;
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
  assetShareValueMultiplierByBank: Map<string, BigNumber>;
  depositOpts: {
    // if deposit looping, this principal amount will be added
    inputDepositAmount: number;
    depositBank: BankType;
    tokenProgram: PublicKey;
    loopMode: "DEPOSIT" | "BORROW";
    // market price (USD per token, UI units) used for the no-slippage deposit estimate
    marketPrice: number;
  };
  borrowOpts: {
    borrowAmount: number;
    borrowBank: BankType;
    tokenProgram: PublicKey;
    // market price (USD per token, UI units) used for the no-slippage deposit estimate
    marketPrice: number;
  };
  swapOpts: SwapOpts;
  addressLookupTableAccounts?: AddressLookupTableAccount[];
  overrideInferAccounts?: {
    group?: PublicKey;
    authority?: PublicKey;
  };
  additionalIxs?: TransactionInstruction[];
  crossbarUrl?: string;
  /**
   * Optional override for how the swap engine runs. Defaults to the in-process
   * `runSwapEngine`; the app injects a runner that forwards to `/api/tx/swap-engine`
   * so the multi-provider fan-out happens server-side.
   */
  swapEngineRunner?: SwapEngineRunner;
}

/**
 * Describes a loop flashloan that has been built up to — but not including — the swap.
 * Handed off to the swap engine, which selects a route against the remaining tx budget
 * and returns the swap instruction(s) to splice into `innerIxs` at `swapSlotIndex`.
 *
 * The flashloan wrapper (begin/end-FL) is intentionally NOT part of `innerIxs`; its size
 * and account cost are already accounted for in `sizeConstraint` / `maxSwapTotalAccounts`.
 */
export interface LoopFlashloanDescriptor {
  // Inner instructions in final order: [cuRequest..., borrow..., <swap slot>, deposit...]
  innerIxs: TransactionInstruction[];
  // Array index in `innerIxs` where the swap instruction(s) should be inserted
  swapSlotIndex: number;
  // Index of the deposit instruction in `innerIxs` (for the post-swap amount byte-patch)
  depositIxIndex: number;
  inputMint: string;
  outputMint: string;
  inputDecimals: number;
  outputDecimals: number;
  // Borrow amount in native (base) units — the swap input amount (ExactIn)
  inAmountNative: number;
  destinationTokenAccount: PublicKey;
  // Remaining tx budget for the swap, already net of the flashloan wrapper cost
  sizeConstraint: number;
  maxSwapTotalAccounts: number;
  luts: AddressLookupTableAccount[];
}

export interface MakeRepayWithCollatTxParams {
  program: MarginfiProgram;
  marginfiAccount: MarginfiAccountType;
  connection: Connection;
  bankMap: Map<string, BankType>;
  oraclePrices: Map<string, OraclePrice>;
  assetShareValueMultiplierByBank: Map<string, BigNumber>;
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
  swapOpts: SwapOpts;
  addressLookupTableAccounts?: AddressLookupTableAccount[];
  overrideInferAccounts?: {
    group?: PublicKey;
    authority?: PublicKey;
  };
  additionalIxs?: TransactionInstruction[];
  crossbarUrl?: string;
  /** See `MakeLoopTxParams.swapEngineRunner`. */
  swapEngineRunner?: SwapEngineRunner;
}

export interface MakeSwapCollateralTxParams {
  program: MarginfiProgram;
  marginfiAccount: MarginfiAccountType;
  connection: Connection;
  bankMap: Map<string, BankType>;
  oraclePrices: Map<string, OraclePrice>;
  bankMetadataMap: BankIntegrationMetadataMap;
  assetShareValueMultiplierByBank: Map<string, BigNumber>;
  withdrawOpts: {
    // Amount of the total position (used for withdrawAll case)
    totalPositionAmount: number;
    // Amount to withdraw (optional, defaults to totalPositionAmount for full swap)
    withdrawAmount?: number;
    withdrawBank: BankType;
    tokenProgram: PublicKey;
  };
  depositOpts: {
    depositBank: BankType;
    tokenProgram: PublicKey;
  };
  swapOpts: SwapOpts;
  addressLookupTableAccounts?: AddressLookupTableAccount[];
  overrideInferAccounts?: {
    group?: PublicKey;
    authority?: PublicKey;
  };
  additionalIxs?: TransactionInstruction[];
  crossbarUrl?: string;
  /** See `MakeLoopTxParams.swapEngineRunner`. */
  swapEngineRunner?: SwapEngineRunner;
}

/**
 * Params for {@link makeRollPtTx} — rolling a matured Exponent PT collateral position
 * into its next-maturity PT.
 *
 * The roll deliberately splits the two legs to avoid AMM slippage on the matured side:
 *   1. withdraw the old PT, then `merge` it 1:1 into the underlying (Exponent, no slippage)
 *   2. swap the underlying into the new PT via the swap engine (Titan/Jupiter route)
 *   3. deposit the new PT.
 *
 * The Exponent-account resolution (decoding the maturity `Vault`) and the redeemed-amount
 * sizing (from `Vault.final_sy_exchange_rate`) are the caller's responsibility and are
 * passed in via `mergeAccounts` / `underlying` / `redeemedAmountNative`.
 */
export interface MakeRollPtTxParams {
  program: MarginfiProgram;
  marginfiAccount: MarginfiAccountType;
  connection: Connection;
  bankMap: Map<string, BankType>;
  oraclePrices: Map<string, OraclePrice>;
  bankMetadataMap: BankIntegrationMetadataMap;
  assetShareValueMultiplierByBank: Map<string, BigNumber>;
  withdrawOpts: {
    totalPositionAmount: number;
    withdrawAmount?: number;
    /** The expiring (matured) PT bank. */
    withdrawBank: BankType;
    tokenProgram: PublicKey;
  };
  depositOpts: {
    /** The successor (next-maturity) PT bank. */
    depositBank: BankType;
    tokenProgram: PublicKey;
  };
  /** Resolved Exponent `merge` accounts for the matured vault (see ExponentMergeAccounts). */
  mergeAccounts: ExponentMergeAccounts;
  /** The token `merge` outputs and the swap consumes (the vault's SY/underlying). */
  underlying: { mint: PublicKey; decimals: number; tokenProgram?: PublicKey };
  /**
   * Native amount of `underlying` the `merge` will yield (≈ PT amount × the vault's
   * `final_sy_exchange_rate`; for a matured vault redemption is fixed). Drives the
   * engine quote for the buy leg.
   */
  redeemedAmountNative: bigint;
  swapOpts: SwapOpts;
  addressLookupTableAccounts?: AddressLookupTableAccount[];
  overrideInferAccounts?: {
    group?: PublicKey;
    authority?: PublicKey;
  };
  crossbarUrl?: string;
  /** See `MakeLoopTxParams.swapEngineRunner`. */
  swapEngineRunner?: SwapEngineRunner;
}

export interface MakeSwapDebtTxParams {
  program: MarginfiProgram;
  marginfiAccount: MarginfiAccountType;
  connection: Connection;
  bankMap: Map<string, BankType>;
  oraclePrices: Map<string, OraclePrice>;
  bankMetadataMap: BankIntegrationMetadataMap;
  assetShareValueMultiplierByBank: Map<string, BigNumber>;
  // Source debt (what we're repaying)
  repayOpts: {
    // Amount of the total debt position (used for repayAll case)
    totalPositionAmount: number;
    // Amount to repay (optional, defaults to totalPositionAmount for full swap)
    repayAmount?: number;
    repayBank: BankType;
    tokenProgram: PublicKey;
    // Market price (USD per token, UI units) used to size the borrow amount.
    marketPrice: number;
  };
  // Destination debt (what we're borrowing)
  borrowOpts: {
    borrowBank: BankType;
    tokenProgram: PublicKey;
    // Market price (USD per token, UI units) used to size the borrow amount.
    marketPrice: number;
  };
  swapOpts: SwapOpts;
  addressLookupTableAccounts?: AddressLookupTableAccount[];
  overrideInferAccounts?: {
    group?: PublicKey;
    authority?: PublicKey;
  };
  additionalIxs?: TransactionInstruction[];
  crossbarUrl?: string;
  /** See `MakeLoopTxParams.swapEngineRunner`. */
  swapEngineRunner?: SwapEngineRunner;
}

export interface MakeSetupIxParams {
  connection: Connection;
  authority: PublicKey;
  tokens: {
    mint: PublicKey;
    tokenProgram: PublicKey;
  }[];
}
