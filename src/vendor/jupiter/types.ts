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
