// Vendored Jupiter Swap API types — cherry-picked from @jup-ag/api
// Source: https://github.com/jup-ag/jupiter-quote-api-node (Apache-2.0)
//
// We vendor only the request/response shapes the SDK actually uses instead of
// depending on the @jup-ag/api package, which is generated against an outdated
// OpenAPI spec and a stale hardcoded base URL. Keeping these locally lets us
// track Jupiter's current Swap API ourselves. See ./client.ts for the runtime.

/** Swap direction. */
export type SwapMode = "ExactIn" | "ExactOut";

// --- Quote ---

/** Optional instruction format version for the swap-instructions endpoint. */
export type InstructionVersion = "V1" | "V2";

/** Query parameters for `GET /quote`. */
export interface QuoteGetRequest {
  inputMint: string;
  outputMint: string;
  amount: number;
  slippageBps?: number;
  swapMode?: SwapMode;
  dexes?: Array<string>;
  excludeDexes?: Array<string>;
  restrictIntermediateTokens?: boolean;
  onlyDirectRoutes?: boolean;
  asLegacyTransaction?: boolean;
  platformFeeBps?: number;
  maxAccounts?: number;
  instructionVersion?: InstructionVersion;
  dynamicSlippage?: boolean;
  /**
   * Set to true if the quote will be consumed in a Jito bundle. Excludes DEXes
   * that are incompatible with Jito bundles (e.g. HumidiFi). Flashloan swaps in
   * this SDK always execute inside a Jito bundle, so they set this to true.
   */
  forJitoBundle?: boolean;
}

export interface PlatformFee {
  amount?: string;
  feeBps?: number;
}

export interface SwapInfo {
  ammKey: string;
  label?: string;
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
}

export interface RoutePlanStep {
  swapInfo: SwapInfo;
  percent?: number | null;
  bps?: number;
}

/** Response from `GET /quote`. */
export interface QuoteResponse {
  inputMint: string;
  inAmount: string;
  outputMint: string;
  outAmount: string;
  otherAmountThreshold: string;
  swapMode: SwapMode;
  slippageBps: number;
  platformFee?: PlatformFee;
  priceImpactPct: string;
  routePlan: Array<RoutePlanStep>;
  contextSlot?: number;
  timeTaken?: number;
}

// --- Swap instructions ---

export interface AccountMeta {
  pubkey: string;
  isSigner: boolean;
  isWritable: boolean;
}

export interface Instruction {
  programId: string;
  accounts: Array<AccountMeta>;
  data: string;
}

/**
 * Body for `POST /swap-instructions`. Only the fields the SDK sets are modelled
 * explicitly; the remaining optional knobs are passed through loosely so we
 * don't have to track every Jupiter request option.
 */
export interface SwapRequest {
  quoteResponse: QuoteResponse;
  userPublicKey: string;
  payer?: string;
  wrapAndUnwrapSol?: boolean;
  useSharedAccounts?: boolean;
  feeAccount?: string;
  trackingAccount?: string;
  prioritizationFeeLamports?: unknown;
  asLegacyTransaction?: boolean;
  destinationTokenAccount?: string;
  nativeDestinationAccount?: string;
  dynamicComputeUnitLimit?: boolean;
  skipUserAccountsRpcCalls?: boolean;
  dynamicSlippage?: boolean;
  computeUnitPriceMicroLamports?: number;
  blockhashSlotsToExpiry?: number;
}

/** Response from `POST /swap-instructions`. */
export interface SwapInstructionsResponse {
  otherInstructions: Array<Instruction>;
  computeBudgetInstructions: Array<Instruction>;
  setupInstructions: Array<Instruction>;
  swapInstruction: Instruction;
  cleanupInstruction?: Instruction;
  addressLookupTableAddresses: Array<string>;
}

// --- Router (`GET /swap/v2/build`) ---
//
// The Router endpoint replaces Metis `/quote` + `/swap-instructions` with a
// single call. ExactIn only. It returns raw instructions plus the ALT contents
// inline (`addressesByLookupTableAddress`), so no separate RPC fetch is needed.
// See ./client.ts and the "Metis to Router" migration guide.

/** Query parameters for `GET /swap/v2/build`. */
export interface BuildGetRequest {
  inputMint: string;
  outputMint: string;
  amount: number;
  /** The account performing the swap (replaces Metis `userPublicKey`). */
  taker: string;
  slippageBps?: number;
  /** "fast" trades route optimality for lower latency. */
  mode?: "fast";
  dexes?: Array<string>;
  excludeDexes?: Array<string>;
  platformFeeBps?: number;
  feeAccount?: string;
  maxAccounts?: number;
  payer?: string;
  wrapAndUnwrapSol?: boolean;
  destinationTokenAccount?: string;
  /**
   * Set to true if the transaction will be submitted as part of a Jito bundle.
   * Excludes DEXes that are incompatible with Jito bundles (their routes can
   * lock vote accounts, which Jito rejects with "bundles cannot lock any vote
   * accounts"). Defaults to false on the API side.
   */
  forJitoBundle?: boolean;
}

/** Response from `GET /swap/v2/build`. */
export interface BuildResponse {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  otherAmountThreshold: string;
  swapMode: string;
  slippageBps: number;
  routePlan: Array<RoutePlanStep>;
  computeBudgetInstructions: Array<Instruction>;
  setupInstructions: Array<Instruction>;
  swapInstruction: Instruction;
  cleanupInstruction?: Instruction | null;
  otherInstructions?: Array<Instruction>;
  tipInstruction?: Instruction | null;
  /** Map of ALT address -> the addresses stored inside it (in order). */
  addressesByLookupTableAddress?: Record<string, string[]> | null;
  blockhashWithMetadata?: {
    blockhash: number[];
    lastValidBlockHeight: number;
  };
}
