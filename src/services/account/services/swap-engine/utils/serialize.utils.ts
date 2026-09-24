import {
  address,
  getBase64Decoder,
  getBase64Encoder,
  isSignerRole,
  isWritableRole,
  type AddressesByLookupTableAddress,
  type Instruction,
} from "@solana/kit";

import { SwapEngineRequest, SwapEngineResult, TxFootprint } from "../types";

import { SwapApiConfig, SwapProvider } from "~/services/account/types";
import { toAccountRole } from "~/utils";

/**
 * Wire serialization for the swap engine, so the provider fan-out can run behind
 * an HTTP endpoint (Design B). The request intentionally omits `rpc` and
 * per-provider `apiConfig` — the server supplies RPC + API keys from its env.
 */

export interface SerializedInstruction {
  programId: string;
  keys: { pubkey: string; isSigner: boolean; isWritable: boolean }[];
  data: string; // base64
}

export interface SerializedLut {
  key: string;
  addresses: string[];
}

export interface SerializedTxFootprint {
  instructions: SerializedInstruction[];
  luts: SerializedLut[];
  wrapperInstructions?: SerializedInstruction[];
  payer: string;
  sizeConstraint: number;
  maxSwapTotalAccounts: number;
}

export interface SerializedSwapEngineRequest {
  inputMint: string;
  outputMint: string;
  amountNative: number;
  inputDecimals: number;
  outputDecimals: number;
  slippageBps?: number;
  slippageMode?: "DYNAMIC" | "FIXED";
  platformFeeBps?: number;
  directRoutesOnly?: boolean;
  taker: string;
  destinationTokenAccount: string;
  footprint?: SerializedTxFootprint;
  /** Provider names only; the server attaches each provider's apiConfig. */
  providers: SwapProvider[];
  jupiterMaxAccountsLadder?: number[];
}

export interface SerializedSwapEngineResult {
  swapInstructions: SerializedInstruction[];
  setupInstructions: SerializedInstruction[];
  swapLuts: SerializedLut[];
  quoteResponse: SwapEngineResult["quoteResponse"];
  outputAmountNative: string;
  provider: SwapProvider;
}

// --- instruction / lut ---

export function serializeInstruction(ix: Instruction): SerializedInstruction {
  return {
    programId: ix.programAddress,
    keys: (ix.accounts ?? []).map((account) => ({
      pubkey: account.address,
      isSigner: isSignerRole(account.role),
      isWritable: isWritableRole(account.role),
    })),
    data: getBase64Decoder().decode(ix.data ?? new Uint8Array()),
  };
}

export function deserializeInstruction(s: SerializedInstruction): Instruction {
  return {
    programAddress: address(s.programId),
    accounts: s.keys.map((k) => ({
      address: address(k.pubkey),
      role: toAccountRole(k.isSigner, k.isWritable),
    })),
    data: getBase64Encoder().encode(s.data),
  };
}

function serializeLuts(luts: AddressesByLookupTableAddress): SerializedLut[] {
  return Object.entries(luts).map(([key, addresses]) => ({ key, addresses }));
}

function deserializeLuts(s: SerializedLut[]): AddressesByLookupTableAddress {
  return Object.fromEntries(
    s.map((lut) => [address(lut.key), lut.addresses.map((a) => address(a))])
  );
}

// --- request ---

export function serializeSwapEngineRequest(req: SwapEngineRequest): SerializedSwapEngineRequest {
  return {
    inputMint: req.inputMint,
    outputMint: req.outputMint,
    amountNative: req.amountNative,
    inputDecimals: req.inputDecimals,
    outputDecimals: req.outputDecimals,
    slippageBps: req.slippageBps,
    slippageMode: req.slippageMode,
    platformFeeBps: req.platformFeeBps,
    directRoutesOnly: req.directRoutesOnly,
    taker: req.taker,
    destinationTokenAccount: req.destinationTokenAccount,
    footprint: req.footprint ? serializeFootprint(req.footprint) : undefined,
    providers: req.providers.map((p) => p.provider),
    jupiterMaxAccountsLadder: req.jupiterMaxAccountsLadder,
  };
}

function serializeFootprint(f: TxFootprint): SerializedTxFootprint {
  return {
    instructions: f.instructions.map(serializeInstruction),
    luts: serializeLuts(f.luts),
    wrapperInstructions: f.wrapperInstructions?.map(serializeInstruction),
    payer: f.payer,
    sizeConstraint: f.sizeConstraint,
    maxSwapTotalAccounts: f.maxSwapTotalAccounts,
  };
}

/**
 * Rebuild a `SwapEngineRequest` server-side. The caller supplies the `rpc` client
 * and the per-provider `apiConfig` (gateway URLs + API keys) so those never
 * travel over the wire.
 * @throws if an address string is invalid
 */
export function deserializeSwapEngineRequest(
  s: SerializedSwapEngineRequest,
  ctx: {
    rpc: SwapEngineRequest["rpc"];
    providerApiConfigs?: Partial<Record<SwapProvider, SwapApiConfig>>;
  }
): SwapEngineRequest {
  return {
    inputMint: s.inputMint,
    outputMint: s.outputMint,
    amountNative: s.amountNative,
    inputDecimals: s.inputDecimals,
    outputDecimals: s.outputDecimals,
    slippageBps: s.slippageBps,
    slippageMode: s.slippageMode,
    platformFeeBps: s.platformFeeBps,
    directRoutesOnly: s.directRoutesOnly,
    taker: address(s.taker),
    destinationTokenAccount: address(s.destinationTokenAccount),
    rpc: ctx.rpc,
    footprint: s.footprint ? deserializeFootprint(s.footprint) : undefined,
    providers: s.providers.map((provider) => ({
      provider,
      apiConfig: ctx.providerApiConfigs?.[provider],
    })),
    jupiterMaxAccountsLadder: s.jupiterMaxAccountsLadder,
  };
}

function deserializeFootprint(s: SerializedTxFootprint): TxFootprint {
  return {
    instructions: s.instructions.map(deserializeInstruction),
    luts: deserializeLuts(s.luts),
    wrapperInstructions: s.wrapperInstructions?.map(deserializeInstruction),
    payer: address(s.payer),
    sizeConstraint: s.sizeConstraint,
    maxSwapTotalAccounts: s.maxSwapTotalAccounts,
  };
}

// --- result ---

export function serializeSwapEngineResult(res: SwapEngineResult): SerializedSwapEngineResult {
  return {
    swapInstructions: res.swapInstructions.map(serializeInstruction),
    setupInstructions: res.setupInstructions.map(serializeInstruction),
    swapLuts: serializeLuts(res.swapLuts),
    quoteResponse: res.quoteResponse,
    outputAmountNative: res.outputAmountNative.toString(),
    provider: res.provider,
  };
}

/** @throws if an address string is invalid */
export function deserializeSwapEngineResult(s: SerializedSwapEngineResult): SwapEngineResult {
  return {
    swapInstructions: s.swapInstructions.map(deserializeInstruction),
    setupInstructions: s.setupInstructions.map(deserializeInstruction),
    swapLuts: deserializeLuts(s.swapLuts),
    quoteResponse: s.quoteResponse,
    outputAmountNative: BigInt(s.outputAmountNative),
    provider: s.provider,
  };
}
