// Vendored Titan protocol types — cherry-picked from @titanexchange/sdk-ts
// Source: https://github.com/Titan-Pathfinder/titan-sdk-ts (MIT)

// --- Common types ---

/** A Solana account public key, encoded as 32 bytes by msgpack. */
export type Pubkey = Uint8Array;

/** Solana account metadata for an instruction. */
export interface AccountMeta {
  /** Public key for the account. */
  p: Pubkey;
  /** Whether the account is a signer. */
  s: boolean;
  /** Whether the account is writable. */
  w: boolean;
}

/** A single instruction to be executed as part of a transaction. */
export interface Instruction {
  /** Program id. */
  p: Pubkey;
  /** Account metadata. */
  a: AccountMeta[];
  /** Instruction data. */
  d: Uint8Array;
}

/** An address lookup table referenced by a transaction template (key + inner addresses). */
export interface TransactionTemplateLut {
  /** ALT account address. */
  p: Pubkey;
  /** Addresses stored inside the ALT, in order. */
  a: Pubkey[];
}

/**
 * Footprint of the instructions/ALTs surrounding the swap, so the router sizes
 * routes to fit alongside them. Wire format uses single-letter fields: `i`
 * instructions, `a` ALTs, `m` extra account metas. See the gateway helper
 * `buildTitanTemplate`. Over the WebSocket this is sent as a native msgpack
 * object (no base64) — unlike the gateway GET there is no URL-length limit, so
 * large ALTs are fine.
 */
export interface TransactionTemplate {
  i: Instruction[];
  a: TransactionTemplateLut[];
  m: AccountMeta[];
}

export enum SwapMode {
  ExactIn = "ExactIn",
  ExactOut = "ExactOut",
}

// --- Client request types ---

export type Uint64 = number | bigint;

export interface ClientRequest {
  id: number;
  data: RequestData;
}

export type RequestData =
  | { NewSwapQuoteStream: SwapQuoteRequest }
  | { StopStream: StopStreamRequest };

export interface SwapQuoteRequest {
  swap: SwapParams;
  transaction: TransactionParams;
  update?: QuoteUpdateParams;
}

export interface SwapParams {
  inputMint: Pubkey;
  outputMint: Pubkey;
  amount: Uint64;
  swapMode?: SwapMode;
  slippageBps?: number;
  dexes?: string[];
  excludeDexes?: string[];
  onlyDirectRoutes?: boolean;
  addSizeConstraint?: boolean;
  sizeConstraint?: number;
  providers?: string[];
  /** Limit total number of accounts used by routes. Default: 256. Available since v1.1. */
  accountsLimitTotal?: number;
  /** Limit writable accounts used by routes. Default: 64. Available since v1.1. */
  accountsLimitWritable?: number;
  /**
   * Reserve room for the surrounding (non-swap) instructions + ALTs so the
   * router sizes routes to fit. Mutually exclusive with `sizeConstraint` /
   * `accountsLimitTotal` / `accountsLimitWritable`. Available since v1.2.
   */
  transactionTemplate?: TransactionTemplate;
}

export interface TransactionParams {
  userPublicKey: Pubkey;
  closeInputTokenAccount?: boolean;
  createOutputTokenAccount?: boolean;
  feeAccount?: Pubkey;
  feeBps?: number;
  feeFromInputMint?: boolean;
  outputAccount?: Pubkey;
  titanSwapVersion?: SwapVersion;
  /**
   * `true` leaves a wSOL output as wrapped SOL (the wSOL SPL token) instead of
   * unwrapping it to native lamports. Default `false`. Only has an effect when
   * `outputMint == wSOL`; ignored otherwise. Requires `titanSwapVersion=3`.
   */
  outputWsol?: boolean;
}

export enum SwapVersion {
  V2 = 2,
  V3 = 3,
}

export interface QuoteUpdateParams {
  intervalMs?: Uint64;
  num_quotes: number;
}

export interface StopStreamRequest {
  id: number;
}

// --- Server message types ---

export type ServerMessage =
  | { Response: ResponseSuccess }
  | { Error: ResponseError }
  | { StreamData: StreamData }
  | { StreamEnd: StreamEnd };

export type ResponseData =
  | { NewSwapQuoteStream: QuoteSwapStreamResponse }
  | { StreamStopped: StopStreamResponse };

export interface StreamStart {
  id: number;
  dataType: string;
}

export interface ResponseSuccess {
  requestId: number;
  data: ResponseData;
  stream?: StreamStart;
}

export interface ResponseError {
  requestId: number;
  code: number;
  message: string;
}

export type StreamDataPayload = { SwapQuotes: SwapQuotes };

export interface StreamData {
  id: number;
  seq: number;
  payload: StreamDataPayload;
}

export interface StreamEnd {
  id: number;
  errorCode?: number;
  errorMessage?: string;
}

export interface QuoteSwapStreamResponse {
  intervalMs: number;
}

export interface StopStreamResponse {
  id: number;
}

// --- Quote / Route types ---

export interface SwapQuotes {
  id: string;
  inputMint: Uint8Array;
  outputMint: Uint8Array;
  swapMode: SwapMode;
  amount: number;
  quotes: { [key: string]: SwapRoute };
  /** Present when DART is enabled; names the route Titan recommends. */
  metadata?: { ExpectedWinner?: string };
}

export interface SwapRoute {
  inAmount: number;
  outAmount: number;
  slippageBps: number;
  platformFee?: PlatformFee;
  steps: RoutePlanStep[];
  instructions: Instruction[];
  addressLookupTables: Pubkey[];
  contextSlot?: number;
  timeTaken?: number;
  expiresAtMs?: number;
  expiresAfterSlot?: number;
  computeUnits?: number;
  computeUnitsSafe?: number;
  transaction?: Uint8Array;
  referenceId?: string;
}

export interface PlatformFee {
  amount: number;
  fee_bps: number;
}

export interface RoutePlanStep {
  ammKey: Uint8Array;
  label: string;
  inputMint: Uint8Array;
  outputMint: Uint8Array;
  inAmount: number;
  outAmount: number;
  allocPpb: number;
  feeMint?: Uint8Array;
  feeAmount?: number;
  contextSlot?: number;
}
