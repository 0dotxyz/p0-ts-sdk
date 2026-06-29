// Shared Titan proxy response helpers — used by both SDK and web app
// to deserialize, select, and build results from the HTTP proxy's
// base64-serialized responses.

import {
  AddressLookupTableAccount,
  Connection,
  PublicKey,
  TransactionInstruction,
} from "@solana/web3.js";

// --- Serialized (base64) types from the HTTP proxy ---

export interface SerializedInstruction {
  p: string; // base64 program id
  a: { p: string; s: boolean; w: boolean }[]; // base64 accounts
  d: string; // base64 data
}

export interface SerializedSwapRoute {
  inAmount: number;
  outAmount: number;
  slippageBps: number;
  platformFee?: { amount: number; fee_bps: number };
  instructions: SerializedInstruction[];
  addressLookupTables: string[]; // base64 encoded pubkeys
  contextSlot?: number;
  timeTaken?: number;
}

export interface TitanProxySwapQuoteResponse {
  quotes: { [providerId: string]: SerializedSwapRoute };
  inputMint: string; // base64
  outputMint: string; // base64
  swapMode: string;
  amount: number;
}

export interface TitanProxyExactOutResponse {
  inAmount: number;
  outAmount: number;
  otherAmountThreshold: string;
  slippageBps: number;
}

// --- Deserialization ---

/**
 * Titan's router stamps a read-only `jitodontfront…` MEV-guard account onto the
 * swap instruction. Jito refuses to bundle any transaction that touches a `jito*`
 * marker, so we drop it to keep the swap landable inside a Jito bundle (our
 * flashloan swaps are bundled).
 */
export const isJitoDontFront = (pubkey: PublicKey) =>
  pubkey.toBase58().startsWith("jitodontfront");

export function deserializeSerializedInstruction(
  ix: SerializedInstruction,
): TransactionInstruction {
  return new TransactionInstruction({
    programId: new PublicKey(Buffer.from(ix.p, "base64")),
    keys: ix.a
      .map((account) => ({
        pubkey: new PublicKey(Buffer.from(account.p, "base64")),
        isSigner: account.s,
        isWritable: account.w,
      }))
      .filter((key) => !isJitoDontFront(key.pubkey)),
    data: Buffer.from(ix.d, "base64"),
  });
}

// --- Route selection ---

export function selectBestRoute<T extends { inAmount: number; outAmount: number }>(
  quotes: { [id: string]: T },
  swapMode: "ExactIn" | "ExactOut",
): T | null {
  const routes = Object.values(quotes);
  if (routes.length === 0) return null;
  return routes.reduce((best, route) => {
    if (swapMode === "ExactIn") {
      return route.outAmount > best.outAmount ? route : best;
    } else {
      return route.inAmount < best.inAmount ? route : best;
    }
  });
}

// --- Quote result builder ---

export interface TitanSwapQuoteResult {
  inAmount: string;
  outAmount: string;
  otherAmountThreshold: string;
  slippageBps: number;
  platformFee?: { amount: string; feeBps: number };
  contextSlot?: number;
  timeTaken?: number;
}

export function buildSwapQuoteResult(
  route: {
    inAmount: number | bigint;
    outAmount: number | bigint;
    slippageBps: number;
    platformFee?: { amount: number | bigint; fee_bps: number };
    contextSlot?: number;
    timeTaken?: number;
  },
  swapMode: "ExactIn" | "ExactOut",
): TitanSwapQuoteResult {
  const slippageBps = route.slippageBps;
  // The WebSocket/protobuf path decodes int64 amounts as BigInt; token amounts fit safely in a
  // JS number, so coerce for the slippage float math (BigInt × number throws).
  const outAmount = Number(route.outAmount);
  const inAmount = Number(route.inAmount);

  let otherAmountThreshold: string;
  if (swapMode === "ExactIn") {
    otherAmountThreshold = String(Math.floor(outAmount * (1 - slippageBps / 10000)));
  } else {
    otherAmountThreshold = String(Math.ceil(inAmount * (1 + slippageBps / 10000)));
  }

  return {
    inAmount: String(route.inAmount),
    outAmount: String(route.outAmount),
    otherAmountThreshold,
    slippageBps,
    platformFee: route.platformFee
      ? {
          amount: String(route.platformFee.amount),
          feeBps: route.platformFee.fee_bps,
        }
      : undefined,
    contextSlot: route.contextSlot,
    timeTaken: route.timeTaken,
  };
}

// --- LUT resolution ---

export async function resolveLookupTables(
  connection: Connection,
  lutPubkeys: PublicKey[],
): Promise<AddressLookupTableAccount[]> {
  if (lutPubkeys.length === 0) return [];

  const lutAccountsRaw = await connection.getMultipleAccountsInfo(lutPubkeys);

  return lutAccountsRaw
    .map((accountInfo, index) => {
      if (!accountInfo) return null;
      return new AddressLookupTableAccount({
        key: lutPubkeys[index],
        state: AddressLookupTableAccount.deserialize(accountInfo.data),
      });
    })
    .filter((account): account is AddressLookupTableAccount => account !== null);
}
