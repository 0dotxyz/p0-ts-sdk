import type {
  Address,
  AddressesByLookupTableAddress,
  BlockhashLifetimeConstraint,
  GetAccountInfoApi,
  GetLatestBlockhashApi,
  GetMultipleAccountsApi,
  GetTokenLargestAccountsApi,
  Instruction,
  Rpc,
  SimulateTransactionApi,
  Transaction,
  TransactionSigner,
} from "@solana/kit";
import type { BigNumber } from "bignumber.js";

import type { SwapEngineRunner } from "../services/swap-engine/types";

import { MarginfiAccountType } from "./account.types";

import { BankType } from "~/services/bank";
import { SolanaTransaction, TransactionFormat } from "~/services/transaction";
import { Amount, TypedAmount, BankIntegrationMetadataMap } from "~/types";

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
    instructions: Instruction[];
    lookupTables: AddressesByLookupTableAddress;
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

export interface WrapSolOpts {
  /** Wrap native SOL for a wSOL deposit or repay (default true). */
  wrapSol?: boolean;
  /** wSOL already in the ATA; only the rest is wrapped (default 0). */
  wSolBalanceUi?: number;
}

export interface MakeDepositIxOpts extends WrapSolOpts {
  /** Transaction builders only: don't add `pulse_health` (see {@link PremiumRefreshParams}) */
  skipPremiumRefresh?: boolean;
}

export interface MakeDepositIxParams {
  programAddress: Address;
  bank: BankType;
  tokenProgram: Address;
  /** UI units of the bank's mint */
  amount: Amount;
  marginfiAccount: MarginfiAccountType;
  /** The account authority; signs and owns the source token account. */
  authority: TransactionSigner;
  /** Venue state; required for Kamino and Drift banks. */
  bankMetadataMap?: BankIntegrationMetadataMap;
  opts?: MakeDepositIxOpts;
}

/** Transaction options shared by the single-action builders. */
export interface ActionTxParams {
  rpc: Rpc<GetLatestBlockhashApi>;
  txFormat: TransactionFormat;
  /** Fetched from `rpc` when omitted. */
  latestBlockhash?: BlockhashLifetimeConstraint;
}

/**
 * Account state the deposit and repay transaction builders use to add `pulse_health` after the
 * action while the account has premium-bearing debt, so the program rewrites its variable borrow
 * premium rates as the transaction lands (deposits and repays don't refresh them on their own).
 * Opt out with `opts.skipPremiumRefresh`. The single-transaction builders leave it out when it
 * doesn't fit next to the action.
 */
export interface PremiumRefreshParams {
  /** The account before the action */
  marginfiAccount: MarginfiAccountType;
  bankMap: Map<string, BankType>;
  bankMetadataMap: BankIntegrationMetadataMap;
}

export interface MakePremiumRefreshIxsParams extends PremiumRefreshParams {
  programAddress: Address;
  /** Banks the action opens (the deposited bank) */
  mandatoryBanks: Address[];
  /** Banks the action closes (fully repaid banks) */
  excludedBanks: Address[];
}

export interface AppendPremiumRefreshParams extends MakePremiumRefreshIxsParams {
  /** The action's instructions */
  actionIxs: Instruction[];
  /** The acted-on bank */
  bank: BankType;
  /** Pays the transaction */
  authority: TransactionSigner;
  txFormat: TransactionFormat;
  opts?: { skipPremiumRefresh?: boolean };
}

export interface MakeDepositTxParams
  extends MakeDepositIxParams, ActionTxParams, PremiumRefreshParams {
  bankMetadataMap: BankIntegrationMetadataMap;
}

export interface MakeRepayIxOpts extends WrapSolOpts {
  /** Transaction builders only: don't add `pulse_health` (see {@link PremiumRefreshParams}) */
  skipPremiumRefresh?: boolean;
}

export interface MakeRepayIxParams {
  programAddress: Address;
  bank: BankType;
  tokenProgram: Address;
  /** UI units of the bank's mint */
  amount: Amount;
  marginfiAccount: MarginfiAccountType;
  /** The account authority; signs and owns the source token account. */
  authority: TransactionSigner;
  repayAll?: boolean;
  opts?: MakeRepayIxOpts;
}

export interface MakeRepayTxParams
  extends MakeRepayIxParams, ActionTxParams, PremiumRefreshParams {}

export interface MakeWithdrawIxOpts extends MakeBorrowIxOpts {
  /**
   * Whether the group rate limiter is on (default true). A withdraw-all then appends the closed
   * bank's accounts, where the limiter reads its price; pass false when it's off to save bytes.
   */
  groupRateLimiterEnabled?: boolean;
}

export interface MakeWithdrawIxParams {
  programAddress: Address;
  bank: BankType;
  bankMap: Map<string, BankType>;
  tokenProgram: Address;
  /** UI units of the bank's mint; a Kamino bank also takes a `cToken` amount. */
  amount: Amount | TypedAmount;
  marginfiAccount: MarginfiAccountType;
  /** The account authority; signs and owns the destination token account. */
  authority: TransactionSigner;
  /** Venue state; required for Kamino, Drift and JupLend banks. */
  bankMetadataMap?: BankIntegrationMetadataMap;
  /** Kamino: underlying tokens per cToken, to convert a UI `amount` (default 1). */
  assetShareValueMultiplierByBank?: Map<string, BigNumber>;
  withdrawAll?: boolean;
  opts?: MakeWithdrawIxOpts;
}

/** Withdraw/borrow transactions also refresh the account's integration banks. */
interface AccountActionTxParams extends ActionTxParams {
  bankMetadataMap: BankIntegrationMetadataMap;
}

export interface MakeWithdrawTxParams
  extends Omit<MakeWithdrawIxParams, "bankMetadataMap">, AccountActionTxParams {}

export interface MakeBorrowIxOpts {
  /**
   * The account's active banks when this instruction runs, if earlier instructions in the
   * transaction or bundle change them (default: the account's active banks).
   */
  activeBanks?: Address[];
  /**
   * Unwrap the received wSOL to native SOL (default true). This closes the wSOL ATA, so wSOL already
   * in it is unwrapped too.
   */
  unwrapSol?: boolean;
  /** Create the destination ATA idempotently (default true). */
  createAta?: boolean;
}

export interface MakeBorrowIxParams {
  programAddress: Address;
  bank: BankType;
  bankMap: Map<string, BankType>;
  tokenProgram: Address;
  /** UI units of the bank's mint */
  amount: Amount;
  marginfiAccount: MarginfiAccountType;
  /** The account authority; signs and owns the destination token account. */
  authority: TransactionSigner;
  opts?: MakeBorrowIxOpts;
}

export interface MakeBorrowTxParams extends MakeBorrowIxParams, AccountActionTxParams {}

export interface MakeCreateAccountIxOpts {}

export interface MakeCreateAccountIxParams {
  programAddress: Address;
  /** Owner of the new account; signs and pays its rent. */
  authority: TransactionSigner;
  group: Address;
  /** Index in the account PDA seeds */
  accountIndex: number;
  /** Third-party id in the account PDA seeds (default 0) */
  thirdPartyId?: number;
  opts?: MakeCreateAccountIxOpts;
}

export interface MakeCreateAccountTxParams
  extends Omit<MakeCreateAccountIxParams, "accountIndex">, ActionTxParams {
  rpc: Rpc<GetLatestBlockhashApi & GetMultipleAccountsApi>;
  /** Index in the account PDA seeds; a free one is picked via `rpc` when omitted. */
  accountIndex?: number;
}

export interface MakeCloseAccountIxOpts {}

export interface MakeCloseAccountIxParams {
  programAddress: Address;
  marginfiAccount: MarginfiAccountType;
  /** The account authority; signs, pays and receives the rent. */
  authority: TransactionSigner;
  opts?: MakeCloseAccountIxOpts;
}

export interface MakeCloseAccountTxParams extends MakeCloseAccountIxParams, ActionTxParams {}

export interface MakeTransferAccountIxOpts {}

export interface MakeTransferAccountIxParams {
  programAddress: Address;
  /** The account being transferred; it is left disabled. */
  marginfiAccount: MarginfiAccountType;
  /** The account's current authority; signs. */
  authority: TransactionSigner;
  /** The wallet that will own the new account. */
  newAuthority: Address;
  /** Index in the new account's PDA seeds (with `newAuthority`) */
  accountIndex: number;
  /** Third-party id in the new account's PDA seeds (default 0) */
  thirdPartyId?: number;
  /** Pays the new account's rent and the flat transfer fee. Defaults to `authority`. */
  feePayer?: TransactionSigner;
  /** Global fee wallet from the program's `FeeState`. */
  globalFeeWallet: Address;
  opts?: MakeTransferAccountIxOpts;
}

export interface MakeTransferAccountTxParams
  extends Omit<MakeTransferAccountIxParams, "globalFeeWallet" | "accountIndex">, ActionTxParams {
  rpc: Rpc<GetAccountInfoApi & GetLatestBlockhashApi & GetMultipleAccountsApi>;
  /** Index in the new account's PDA seeds; a free one is picked via `rpc` when omitted. */
  accountIndex?: number;
}

export interface MakePulseHealthIxOpts {
  /**
   * The account's active banks when this instruction runs, if earlier instructions in the
   * transaction or bundle change them (default: the account's active banks).
   */
  activeBanks?: Address[];
}

export interface MakePulseHealthIxParams {
  programAddress: Address;
  marginfiAccount: MarginfiAccountType;
  bankMap: Map<string, BankType>;
  opts?: MakePulseHealthIxOpts;
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
  programAddress: Address;
  marginfiAccount: MarginfiAccountType;
  authority: TransactionSigner;
  bankMap: Map<string, BankType>;
  ixs: Instruction[];
  latestBlockhash: BlockhashLifetimeConstraint;
  txFormat: TransactionFormat;
}

export type TransferPositionSide = "collateral" | "debt";

export interface MakeTransferPositionsTxParams {
  programAddress: Address;
  /** The authority of both accounts; signs and pays. */
  authority: TransactionSigner;
  rpc: Rpc<GetLatestBlockhashApi & GetMultipleAccountsApi>;
  /** Source account A (positions move out of this account). */
  marginfiAccount: MarginfiAccountType;
  /** Banks whose A-positions to move; the side is inferred from A's balance. */
  bankAddresses: Address[];
  /** Destination account B. Omit to create a fresh account inside the flashloan tx. */
  destinationAccount?: MarginfiAccountType;
  /** Only used when `destinationAccount` is omitted. */
  createDestinationOpts?: { accountIndex?: number; thirdPartyId?: number };
  bankMap: Map<string, BankType>;
  bankMetadataMap: BankIntegrationMetadataMap;
  assetShareValueMultiplierByBank: Map<string, BigNumber>;
  /** Token program per transferred bank (bank address → token program). */
  tokenProgramsByBank: Map<string, Address>;
  txFormat: TransactionFormat;
  /** Head-room added to each borrow over the estimated debt for interest accrual. Default 10 bps. */
  borrowPaddingBps?: number;
  /** Max positions per transfer; a larger selection is rejected. Default 5. */
  maxPositions?: number;
  /** Whether the group USD rate limiter is enabled (adds an oracle to each withdraw). Default false. */
  groupRateLimiterEnabled?: boolean;
}

export interface TransferPositionsResult {
  /** Ordered for execution: [setup/crank txs…, flashloan tx]. */
  transactions: SolanaTransaction[];
  /** Index of the flashloan tx in `transactions`. */
  actionTxIndex: number;
  /** The destination account (passed-in, or the projected account created in the tx). */
  destinationAccount: MarginfiAccountType;
  /** Whether all transactions must land atomically in one bundle. */
  mustBeAtomicBundle: boolean;
}

export interface MakeBulkWithdrawTxParams {
  programAddress: Address;
  /** The account authority; signs and pays. */
  authority: TransactionSigner;
  rpc: Rpc<GetLatestBlockhashApi & GetMultipleAccountsApi>;
  marginfiAccount: MarginfiAccountType;
  /** Banks whose FULL positions to withdraw, in execution order. */
  bankAddresses: Address[];
  bankMap: Map<string, BankType>;
  bankMetadataMap: BankIntegrationMetadataMap;
  /** Token program per withdrawn bank (bank address → token program). */
  tokenProgramsByBank: Map<string, Address>;
  txFormat: TransactionFormat;
}

export interface MakeBulkRepayTxParams {
  programAddress: Address;
  /** The account authority; signs and pays. */
  authority: TransactionSigner;
  rpc: Rpc<GetLatestBlockhashApi>;
  marginfiAccount: MarginfiAccountType;
  /** Banks whose FULL debts to repay from the wallet. */
  bankAddresses: Address[];
  bankMap: Map<string, BankType>;
  /** Token program per repaid bank (bank address → token program). */
  tokenProgramsByBank: Map<string, Address>;
  txFormat: TransactionFormat;
  /** Venue state for the refreshes before `pulse_health`; see {@link PremiumRefreshParams} */
  bankMetadataMap: BankIntegrationMetadataMap;
  /** Don't add `pulse_health` after the repays */
  skipPremiumRefresh?: boolean;
}

export interface BulkLendTxsResult {
  /** Ordered for execution: [setup/crank txs…, action txs…]. */
  transactions: SolanaTransaction[];
  /** Index of the first action tx in `transactions`. */
  actionTxIndex: number;
  /** Whether all transactions must land atomically in one bundle. */
  mustBeAtomicBundle: boolean;
}

/** RPC methods the swap flows use: blockhash, ATA and mint lookups, swap lookup tables. */
export type SwapFlowRpc = Rpc<GetAccountInfoApi & GetLatestBlockhashApi & GetMultipleAccountsApi>;

export interface MakeLoopTxParams {
  programAddress: Address;
  marginfiAccount: MarginfiAccountType;
  /** The account authority; signs and pays. */
  authority: TransactionSigner;
  rpc: SwapFlowRpc;
  bankMap: Map<string, BankType>;
  bankMetadataMap: BankIntegrationMetadataMap;
  assetShareValueMultiplierByBank: Map<string, BigNumber>;
  depositOpts: {
    // if deposit looping, this principal amount will be added
    inputDepositAmount: number;
    depositBank: BankType;
    tokenProgram: Address;
    loopMode: "DEPOSIT" | "BORROW";
    // market price (USD per token, UI units) used for the no-slippage deposit estimate
    marketPrice: number;
  };
  borrowOpts: {
    borrowAmount: number;
    borrowBank: BankType;
    tokenProgram: Address;
    // market price (USD per token, UI units) used for the no-slippage deposit estimate
    marketPrice: number;
  };
  swapOpts: SwapOpts;
  txFormat: TransactionFormat;
  additionalIxs?: Instruction[];
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
  innerIxs: Instruction[];
  // Array index in `innerIxs` where the swap instruction(s) should be inserted
  swapSlotIndex: number;
  // Index of the deposit instruction in `innerIxs` (for the post-swap amount byte-patch)
  depositIxIndex: number;
  inputMint: Address;
  outputMint: Address;
  inputDecimals: number;
  outputDecimals: number;
  // Borrow amount in native (base) units — the swap input amount (ExactIn)
  inAmountNative: number;
  destinationTokenAccount: Address;
  // Remaining tx budget for the swap, already net of the flashloan wrapper cost
  sizeConstraint: number;
  maxSwapTotalAccounts: number;
  txFormat: TransactionFormat;
}

export interface MakeRepayWithCollatTxParams {
  programAddress: Address;
  marginfiAccount: MarginfiAccountType;
  /** The account authority; signs and pays. */
  authority: TransactionSigner;
  rpc: SwapFlowRpc;
  bankMap: Map<string, BankType>;
  assetShareValueMultiplierByBank: Map<string, BigNumber>;
  bankMetadataMap: BankIntegrationMetadataMap;
  withdrawOpts: {
    // Amount of the total position
    totalPositionAmount: number;
    // Amount to withdraw to pay for debt
    withdrawAmount: number;
    withdrawBank: BankType;
    tokenProgram: Address;
  };
  repayOpts: {
    repayBank: BankType;
    tokenProgram: Address;
    // Amount of the total position use to determine max repay amount
    totalPositionAmount: number;
  };
  swapOpts: SwapOpts;
  txFormat: TransactionFormat;
  /** See `MakeLoopTxParams.swapEngineRunner`. */
  swapEngineRunner?: SwapEngineRunner;
}

export interface MakeSwapCollateralTxParams {
  programAddress: Address;
  marginfiAccount: MarginfiAccountType;
  /** The account authority; signs and pays. */
  authority: TransactionSigner;
  rpc: SwapFlowRpc;
  bankMap: Map<string, BankType>;
  bankMetadataMap: BankIntegrationMetadataMap;
  assetShareValueMultiplierByBank: Map<string, BigNumber>;
  withdrawOpts: {
    // Amount of the total position (used for withdrawAll case)
    totalPositionAmount: number;
    // Amount to withdraw (optional, defaults to totalPositionAmount for full swap)
    withdrawAmount?: number;
    withdrawBank: BankType;
    tokenProgram: Address;
  };
  depositOpts: {
    depositBank: BankType;
    tokenProgram: Address;
  };
  swapOpts: SwapOpts;
  txFormat: TransactionFormat;
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
  programAddress: Address;
  marginfiAccount: MarginfiAccountType;
  /** The account authority; signs, pays and owns the PT/SY token accounts. */
  authority: TransactionSigner;
  rpc: Rpc<
    GetAccountInfoApi &
      GetLatestBlockhashApi &
      GetMultipleAccountsApi &
      GetTokenLargestAccountsApi &
      SimulateTransactionApi
  >;
  bankMap: Map<string, BankType>;
  /** Venue state for refreshing the account's Kamino / Drift / JupLend banks before the roll. */
  bankMetadataMap: BankIntegrationMetadataMap;
  withdrawOpts: {
    totalPositionAmount: number;
    withdrawAmount?: number;
    /** The expiring (matured) PT bank. */
    withdrawBank: BankType;
    tokenProgram: Address;
  };
  depositOpts: {
    /** The successor (next-maturity) PT bank. */
    depositBank: BankType;
    tokenProgram: Address;
  };
  /** Exponent redeem (`merge`) + successor-CLMM buy config for the matured PT. */
  rollOpts: RollPtOpts;
  /** See {@link RollQuoteSimulator}. Defaults to `rpc.simulateTransaction`. */
  simulateTx?: RollQuoteSimulator;
  txFormat: TransactionFormat;
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
export type RollQuoteSimulator = (tx: Transaction) => Promise<RollQuoteSimResult>;

/**
 * Exponent roll config for {@link makeRollPtTx}. `makeRollPtTx` resolves the matured vault's
 * `merge` accounts and the successor pool's CLMM `trade_pt` accounts internally from these
 * addresses — the caller never assembles Exponent accounts/ixs.
 */
export interface RollPtOpts {
  /** The matured PT's Exponent `MarketTwo` — its `vault` is read (one of market/vault required). */
  maturedMarket?: Address;
  /** …or the matured vault directly. */
  maturedVault?: Address;
  /** The successor maturity's **CLMM** (`MarketThree`) pool — where the new PT trades (SY → PT). */
  successorMarket: Address;
  /** Slippage tolerance (bps) for the SY → PT CLMM swap. Defaults to 50. */
  slippageBps?: number;
  /** Token program for the shared SY mint (defaults to the classic Token program). */
  syTokenProgram?: Address;
  /**
   * Optional dedicated PT-roll address lookup table (fetched internally) that compresses the
   * merge + CLMM-swap flashloan bytes (see `examples/create-pt-roll-lut.ts`). Account *locks*
   * are already bounded by the compact, fixed CLMM footprint.
   */
  lookupTable?: Address;
}

export interface MakeSwapDebtTxParams {
  programAddress: Address;
  marginfiAccount: MarginfiAccountType;
  /** The account authority; signs and pays. */
  authority: TransactionSigner;
  rpc: SwapFlowRpc;
  bankMap: Map<string, BankType>;
  bankMetadataMap: BankIntegrationMetadataMap;
  assetShareValueMultiplierByBank: Map<string, BigNumber>;
  // Source debt (what we're repaying)
  repayOpts: {
    // Amount of the total debt position (used for repayAll case)
    totalPositionAmount: number;
    // Amount to repay (optional, defaults to totalPositionAmount for full swap)
    repayAmount?: number;
    repayBank: BankType;
    tokenProgram: Address;
    // Market price (USD per token, UI units) used to size the borrow amount.
    marketPrice: number;
  };
  // Destination debt (what we're borrowing)
  borrowOpts: {
    borrowBank: BankType;
    tokenProgram: Address;
    // Market price (USD per token, UI units) used to size the borrow amount.
    marketPrice: number;
  };
  swapOpts: SwapOpts;
  txFormat: TransactionFormat;
  additionalIxs?: Instruction[];
  /** See `MakeLoopTxParams.swapEngineRunner`. */
  swapEngineRunner?: SwapEngineRunner;
}

export interface MakeCreateMissingAtaIxsParams {
  rpc: Rpc<GetMultipleAccountsApi>;
  authority: TransactionSigner;
  tokens: {
    mint: Address;
    tokenProgram: Address;
  }[];
}

export interface OrderTriggerParams {
  /** Pair net equity (USD) at or below which the stop-loss fires. */
  stopLossUsd?: BigNumber;
  /** Pair net equity (USD) at or above which the take-profit fires. */
  takeProfitUsd?: BigNumber;
  /** Max slippage the keeper may incur when executing, in percent (protocol cap: 10). */
  maxSlippagePercent: number;
}

export interface MakePlaceOrderIxParams {
  programAddress: Address;
  marginfiAccount: MarginfiAccountType;
  /** The account authority; signs. */
  authority: TransactionSigner;
  /** Bank of the asset-side (collateral) balance. */
  collateralBank: Address;
  /** Bank of the liability-side (debt) balance. */
  debtBank: Address;
  trigger: OrderTriggerParams;
  /** Pays the order rent and the flat anti-spam fee. Defaults to `authority`. */
  feePayer?: TransactionSigner;
  /** Global fee wallet from the program's `FeeState`. */
  globalFeeWallet: Address;
}

export interface MakePlaceOrderTxParams extends Omit<MakePlaceOrderIxParams, "globalFeeWallet"> {
  rpc: Rpc<GetAccountInfoApi & GetLatestBlockhashApi>;
  txFormat: TransactionFormat;
  /** Global fee wallet from the program's `FeeState`; read from chain when omitted. */
  globalFeeWallet?: Address;
}

export interface MakeCloseOrderIxParams {
  programAddress: Address;
  marginfiAccount: MarginfiAccountType;
  /** The account authority; signs. */
  authority: TransactionSigner;
  /** The order PDA to close (see `deriveOrderPda`). */
  order: Address;
  /** Receives the order's rent. Defaults to `authority`. */
  feeRecipient?: Address;
}

export interface MakeCloseOrderTxParams extends MakeCloseOrderIxParams {
  rpc: Rpc<GetLatestBlockhashApi>;
  txFormat: TransactionFormat;
}
