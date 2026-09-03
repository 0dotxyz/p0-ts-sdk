import {
  AddressLookupTableAccount,
  Connection,
  Keypair,
  PublicKey,
  Signer,
  TransactionInstruction,
  VersionedTransaction,
} from "@solana/web3.js";
import BigNumber from "bignumber.js";

import type { SwapEngineRunner } from "../services/swap-engine/types";

import { MarginfiAccountType } from "./account.types";

import { BankType } from "~/services/bank";
import { OraclePrice } from "~/services/price";
import { ExtendedV0Transaction, SolanaTransaction } from "~/services/transaction";
import { Amount, TypedAmount, BankIntegrationMetadataMap, MarginfiProgram } from "~/types";
import { DriftRewards, DriftSpotMarket } from "~/vendor/drift";
import { JupLendingState } from "~/vendor/jup-lend";
import { KaminoReserve } from "~/vendor/klend";

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
  /**
   * Pin an exact, caller-reviewed swap route instead of running the swap engine.
   *
   * The caller owns ATA setup for the route, the route's input amount MUST equal the flow's swap
   * input (e.g. the loop's borrow amount), and the route MUST pay out to the flow's destination
   * token account. `quoteResponse.otherAmountThreshold` (guaranteed min-out, native units) sizes
   * the follow-up amount — e.g. the loop's deposit byte-patch — exactly like an engine-selected
   * route would. For dynamic caller-controlled routing (inspect/veto routes at build time),
   * prefer `swapEngineRunner`.
   *
   * Note: the bridged `makeBridged*Tx` fallbacks are disabled when a pinned route is supplied —
   * a pinned route belongs to the direct pair and cannot be spliced into SDK-composed legs.
   */
  swapIxs?: {
    instructions: TransactionInstruction[];
    lookupTables: AddressLookupTableAccount[];
    /** The pinned route's quote; `otherAmountThreshold` must be the route's min-out (native). */
    quoteResponse: SwapQuoteResult;
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
  reserve: KaminoReserve;
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
  reserve: KaminoReserve;
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

export type TransferPositionSide = "collateral" | "debt";

export interface MakeTransferPositionsTxParams {
  program: MarginfiProgram;
  connection: Connection;
  /** Source account A (positions move out of this account). */
  marginfiAccount: MarginfiAccountType;
  /** Banks whose A-positions to move; the side is inferred from A's balance. */
  bankAddresses: PublicKey[];
  /** Destination account B. Omit to create a fresh account inside the flashloan tx. */
  destinationAccount?: MarginfiAccountType;
  /** Only used when `destinationAccount` is omitted. */
  createDestinationOpts?: { accountIndex?: number; thirdPartyId?: number };
  bankMap: Map<string, BankType>;
  oraclePrices: Map<string, OraclePrice>;
  bankMetadataMap: BankIntegrationMetadataMap;
  assetShareValueMultiplierByBank: Map<string, BigNumber>;
  /** Token program per transferred bank (base58 bank address → token program id). */
  tokenProgramsByBank: Map<string, PublicKey>;
  addressLookupTableAccounts?: AddressLookupTableAccount[];
  /** Head-room added to each borrow over the estimated debt for interest accrual. Default 10 bps. */
  borrowPaddingBps?: number;
  /** Max positions per transfer; a larger selection is rejected. Default 5. */
  maxPositions?: number;
  /** Whether the group USD rate limiter is enabled (adds an oracle to each withdraw). Default false. */
  groupRateLimiterEnabled?: boolean;
  crossbarUrl?: string;
  overrideInferAccounts?: { group?: PublicKey; authority?: PublicKey };
}

export interface TransferPositionsResult {
  /** Ordered for execution: [setup/crank txs…, flashloan tx]. */
  transactions: ExtendedV0Transaction[];
  /** Index of the flashloan tx in `transactions`. */
  actionTxIndex: number;
  /** The destination account (passed-in, or the projected account created in the tx). */
  destinationAccount: MarginfiAccountType;
  /** Whether all transactions must land atomically in one bundle. */
  mustBeAtomicBundle: boolean;
}

export interface MakeBulkWithdrawTxParams {
  program: MarginfiProgram;
  connection: Connection;
  marginfiAccount: MarginfiAccountType;
  /** Banks whose FULL positions to withdraw, in execution order. */
  bankAddresses: PublicKey[];
  bankMap: Map<string, BankType>;
  oraclePrices: Map<string, OraclePrice>;
  bankMetadataMap: BankIntegrationMetadataMap;
  assetShareValueMultiplierByBank: Map<string, BigNumber>;
  /** Token program per withdrawn bank (base58 bank address → token program id). */
  tokenProgramsByBank: Map<string, PublicKey>;
  /** Whether the group USD rate limiter is enabled (adds an oracle to each withdraw). Default false. */
  groupRateLimiterEnabled?: boolean;
  luts: AddressLookupTableAccount[];
  crossbarUrl?: string;
  overrideInferAccounts?: { group?: PublicKey; authority?: PublicKey };
}

export interface MakeBulkRepayTxParams {
  program: MarginfiProgram;
  connection: Connection;
  marginfiAccount: MarginfiAccountType;
  /** Banks whose FULL debts to repay from the wallet. */
  bankAddresses: PublicKey[];
  bankMap: Map<string, BankType>;
  /** Token program per repaid bank (base58 bank address → token program id). */
  tokenProgramsByBank: Map<string, PublicKey>;
  addressLookupTableAccounts?: AddressLookupTableAccount[];
  overrideInferAccounts?: { group?: PublicKey; authority?: PublicKey };
}

export interface BulkLendTxsResult {
  /** Ordered for execution: [setup/crank txs…, action txs…]. */
  transactions: ExtendedV0Transaction[];
  /** Index of the first action tx in `transactions`. */
  actionTxIndex: number;
  /** Whether all transactions must land atomically in one bundle. */
  mustBeAtomicBundle: boolean;
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
   *
   * Also the seam for caller-controlled routing: wrap the default runner to inspect, veto, or
   * replace the selected route before it's spliced into the flashloan (see
   * `examples/16c-loop-pinned-route.ts`). For a fully static, pre-reviewed route use
   * `swapOpts.swapIxs` instead.
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
 * Params for {@link makeRollPtTx} — rolling a matured Exponent PT collateral position into
 * its next-maturity PT, so the **full deposit ends up as new PT** (no leftover), in one
 * flash-loan-wrapped bundle:
 *   1. withdraw the old PT, then Exponent `merge` (redeem PT → SY, post-maturity, 1:1)
 *   2. buy the new PT with that SY directly on the successor's **CLMM** (`MarketThree`) PT/SY
 *      pool via `trade_pt` — no base-token round-trip, no external aggregator
 *   3. deposit the new PT.
 *
 * The buy is liquidity-bounded by the successor pool's depth. The redeem is sized by the
 * vault's `pt_redemption_rate`; the SY → PT price is quoted by simulating a standalone
 * `trade_pt`, so the deposit is sized to the guaranteed minimum out.
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
  /** Exponent redeem (`merge`) + successor-CLMM buy config for the matured PT. */
  rollOpts: RollPtOpts;
  /** See {@link RollQuoteSimulator}. Defaults to `connection.simulateTransaction`. */
  simulateTx?: RollQuoteSimulator;
  addressLookupTableAccounts?: AddressLookupTableAccount[];
  overrideInferAccounts?: {
    group?: PublicKey;
    authority?: PublicKey;
  };
  crossbarUrl?: string;
}

/** One token-account balance snapshot from a {@link makeRollPtTx} quote simulation. */
export interface RollQuoteTokenBalance {
  mint: string;
  owner: string;
  /** Raw native token amount (integer string). */
  amount: string;
}

/**
 * Result of one {@link makeRollPtTx} quote simulation. The roll builder prefers the
 * pre/post token-balance delta (ground truth, reported by bundle-sim transports) and
 * falls back to `returnData` for plain `simulateTransaction` transports — so pass
 * through whichever of these the backend provides.
 */
export interface RollQuoteSimResult {
  err: unknown;
  logs: string[] | null;
  returnData?: { programId: string; data: [string, string] } | null;
  preTokenBalances?: RollQuoteTokenBalance[] | null;
  postTokenBalances?: RollQuoteTokenBalance[] | null;
}

/**
 * Transport for {@link makeRollPtTx}'s quote simulations (standalone, expected-to-succeed
 * transactions). The transaction is unsigned, so implementations must simulate with
 * `sigVerify: false` and `replaceRecentBlockhash: true`. Defaults to
 * `connection.simulateTransaction`; browsers whose RPC proxy disallows
 * `simulateTransaction` inject one that routes through an app-side endpoint instead.
 */
export type RollQuoteSimulator = (tx: VersionedTransaction) => Promise<RollQuoteSimResult>;

/**
 * Exponent roll config for {@link makeRollPtTx}. `makeRollPtTx` resolves the matured vault's
 * `merge` accounts and the successor pool's CLMM `trade_pt` accounts internally from these
 * addresses — the caller never assembles Exponent accounts/ixs.
 */
export interface RollPtOpts {
  /** The matured PT's Exponent `MarketTwo` — its `vault` is read (one of market/vault required). */
  maturedMarket?: PublicKey;
  /** …or the matured vault directly. */
  maturedVault?: PublicKey;
  /** The successor maturity's **CLMM** (`MarketThree`) pool — where the new PT trades (SY → PT). */
  successorMarket: PublicKey;
  /** Slippage tolerance (bps) for the SY → PT CLMM swap. Defaults to 50. */
  slippageBps?: number;
  /** Token program for the shared SY mint (defaults to the classic Token program). */
  syTokenProgram?: PublicKey;
  /**
   * Optional dedicated PT-roll address lookup table (fetched internally) that compresses the
   * merge + CLMM-swap flashloan bytes (see `examples/create-pt-roll-lut.ts`). Account *locks*
   * are already bounded by the compact, fixed CLMM footprint.
   */
  lookupTable?: PublicKey;
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

// ----------------------------------------------------------------------------
// Orders (take-profit / stop-loss)
// ----------------------------------------------------------------------------

/**
 * Trigger thresholds for a take-profit / stop-loss order. Thresholds are the pair's net equity in
 * USD (collateral value − debt value of the two tagged balances), not a token price. At least one
 * of `stopLossUsd` / `takeProfitUsd` must be set; both makes a `Both` order.
 */
export interface OrderTriggerParams {
  /** Pair net equity (USD) at or below which the stop-loss fires. */
  stopLossUsd?: BigNumber;
  /** Pair net equity (USD) at or above which the take-profit fires. */
  takeProfitUsd?: BigNumber;
  /** Max slippage the keeper may incur when executing, in percent (protocol cap: 10). */
  maxSlippagePercent: number;
}

export interface MakePlaceOrderIxParams {
  program: MarginfiProgram;
  marginfiAccount: MarginfiAccountType;
  /** Bank of the asset-side (collateral) balance. */
  collateralBank: PublicKey;
  /** Bank of the liability-side (debt) balance. */
  debtBank: PublicKey;
  trigger: OrderTriggerParams;
  /** Pays the order rent and the flat anti-spam fee. Defaults to the account authority. */
  feePayer?: PublicKey;
  /** Global fee wallet from the program's `FeeState`; fetched from chain when omitted. */
  globalFeeWallet?: PublicKey;
}

export interface MakePlaceOrderTxParams extends MakePlaceOrderIxParams {
  connection: Connection;
  luts: AddressLookupTableAccount[];
  blockhash?: string;
}

export interface MakeCloseOrderIxParams {
  program: MarginfiProgram;
  marginfiAccount: MarginfiAccountType;
  /** The order PDA to close (see `deriveOrderPda`). */
  order: PublicKey;
  /** Receives the order's rent. Defaults to the account authority. */
  feeRecipient?: PublicKey;
}

export interface MakeCloseOrderTxParams extends MakeCloseOrderIxParams {
  connection: Connection;
  luts: AddressLookupTableAccount[];
  blockhash?: string;
}
