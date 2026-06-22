import {
  AddressLookupTableAccount,
  Connection,
  PublicKey,
  TransactionInstruction,
} from "@solana/web3.js";
import BN from "bn.js";

import { SwapApiConfig, SwapProvider } from "~/services/account/types";
import { SwapEngineRequest, SwapEngineResult, TxFootprint } from "../types";

/**
 * Wire serialization for the swap engine, so the provider fan-out can run behind
 * an HTTP endpoint (Design B). The request intentionally omits `connection` and
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

export function serializeInstruction(ix: TransactionInstruction): SerializedInstruction {
  return {
    programId: ix.programId.toBase58(),
    keys: ix.keys.map((k) => ({
      pubkey: k.pubkey.toBase58(),
      isSigner: k.isSigner,
      isWritable: k.isWritable,
    })),
    data: Buffer.from(ix.data).toString("base64"),
  };
}

export function deserializeInstruction(s: SerializedInstruction): TransactionInstruction {
  return new TransactionInstruction({
    programId: new PublicKey(s.programId),
    keys: s.keys.map((k) => ({
      pubkey: new PublicKey(k.pubkey),
      isSigner: k.isSigner,
      isWritable: k.isWritable,
    })),
    data: Buffer.from(s.data, "base64"),
  });
}

export function serializeLut(lut: AddressLookupTableAccount): SerializedLut {
  return {
    key: lut.key.toBase58(),
    addresses: lut.state.addresses.map((a) => a.toBase58()),
  };
}

export function deserializeLut(s: SerializedLut): AddressLookupTableAccount {
  return new AddressLookupTableAccount({
    key: new PublicKey(s.key),
    state: {
      deactivationSlot: BigInt("18446744073709551615"), // u64 max = active
      lastExtendedSlot: 0,
      lastExtendedSlotStartIndex: 0,
      addresses: s.addresses.map((a) => new PublicKey(a)),
    },
  });
}

// --- request ---

export function serializeSwapEngineRequest(
  req: SwapEngineRequest
): SerializedSwapEngineRequest {
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
    taker: req.taker.toBase58(),
    destinationTokenAccount: req.destinationTokenAccount.toBase58(),
    footprint: req.footprint ? serializeFootprint(req.footprint) : undefined,
    providers: req.providers.map((p) => p.provider),
    jupiterMaxAccountsLadder: req.jupiterMaxAccountsLadder,
  };
}

function serializeFootprint(f: TxFootprint): SerializedTxFootprint {
  return {
    instructions: f.instructions.map(serializeInstruction),
    luts: f.luts.map(serializeLut),
    wrapperInstructions: f.wrapperInstructions?.map(serializeInstruction),
    payer: f.payer.toBase58(),
    sizeConstraint: f.sizeConstraint,
    maxSwapTotalAccounts: f.maxSwapTotalAccounts,
  };
}

/**
 * Rebuild a `SwapEngineRequest` server-side. The caller supplies the RPC
 * `connection` and the per-provider `apiConfig` (gateway URLs + API keys) so
 * those never travel over the wire.
 */
export function deserializeSwapEngineRequest(
  s: SerializedSwapEngineRequest,
  ctx: {
    connection: Connection;
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
    taker: new PublicKey(s.taker),
    destinationTokenAccount: new PublicKey(s.destinationTokenAccount),
    connection: ctx.connection,
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
    luts: s.luts.map(deserializeLut),
    wrapperInstructions: s.wrapperInstructions?.map(deserializeInstruction),
    payer: new PublicKey(s.payer),
    sizeConstraint: s.sizeConstraint,
    maxSwapTotalAccounts: s.maxSwapTotalAccounts,
  };
}

// --- result ---

export function serializeSwapEngineResult(res: SwapEngineResult): SerializedSwapEngineResult {
  return {
    swapInstructions: res.swapInstructions.map(serializeInstruction),
    setupInstructions: res.setupInstructions.map(serializeInstruction),
    swapLuts: res.swapLuts.map(serializeLut),
    quoteResponse: res.quoteResponse,
    outputAmountNative: res.outputAmountNative.toString(),
    provider: res.provider,
  };
}

export function deserializeSwapEngineResult(s: SerializedSwapEngineResult): SwapEngineResult {
  return {
    swapInstructions: s.swapInstructions.map(deserializeInstruction),
    setupInstructions: s.setupInstructions.map(deserializeInstruction),
    swapLuts: s.swapLuts.map(deserializeLut),
    quoteResponse: s.quoteResponse,
    outputAmountNative: new BN(s.outputAmountNative),
    provider: s.provider,
  };
}
