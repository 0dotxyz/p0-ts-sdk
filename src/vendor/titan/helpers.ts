// Shared Titan proxy response helpers — used by both SDK and web app
// to deserialize, select, and build results from the HTTP proxy's
// base64-serialized responses.

import {
  AccountRole,
  assertAccountDecoded,
  fetchJsonParsedAccounts,
  getAddressDecoder,
  getBase64Encoder,
  upgradeRoleToSigner,
  upgradeRoleToWritable,
  type Address,
  type AddressesByLookupTableAddress,
  type GetMultipleAccountsApi,
  type Instruction,
  type Rpc,
} from "@solana/kit";
import { BigNumber } from "bignumber.js";

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
export const isJitoDontFront = (address: Address) => address.startsWith("jitodontfront");

/** Kit account role for Titan's `s` (signer) / `w` (writable) flags. */
export function titanAccountRole(isSigner: boolean, isWritable: boolean): AccountRole {
  const role = isWritable ? upgradeRoleToWritable(AccountRole.READONLY) : AccountRole.READONLY;
  return isSigner ? upgradeRoleToSigner(role) : role;
}

/** Deserializes a base64 HTTP-proxy instruction, dropping the `jitodontfront` marker account. */
export function deserializeSerializedInstruction(ix: SerializedInstruction): Instruction {
  const fromBase64 = (value: string) =>
    getAddressDecoder().decode(getBase64Encoder().encode(value));
  return {
    programAddress: fromBase64(ix.p),
    accounts: ix.a
      .map((account) => ({
        address: fromBase64(account.p),
        role: titanAccountRole(account.s, account.w),
      }))
      .filter((account) => !isJitoDontFront(account.address)),
    data: getBase64Encoder().encode(ix.d),
  };
}

// --- Route selection ---

export function selectBestRoute<T extends { inAmount: number; outAmount: number }>(
  quotes: { [id: string]: T },
  swapMode: "ExactIn" | "ExactOut"
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

/** Builds a quote with native-unit amount strings, rounding the slippage threshold down for ExactIn or up for ExactOut. */
export function buildSwapQuoteResult(
  route: {
    inAmount: number | bigint;
    outAmount: number | bigint;
    slippageBps: number;
    platformFee?: { amount: number | bigint; fee_bps: number };
    contextSlot?: number;
    timeTaken?: number;
  },
  swapMode: "ExactIn" | "ExactOut"
): TitanSwapQuoteResult {
  const slippageBps = route.slippageBps;
  const slippage = new BigNumber(slippageBps).shiftedBy(-4);

  let otherAmountThreshold: string;
  if (swapMode === "ExactIn") {
    otherAmountThreshold = new BigNumber(route.outAmount.toString())
      .times(new BigNumber(1).minus(slippage))
      .toFixed(0, BigNumber.ROUND_FLOOR);
  } else {
    otherAmountThreshold = new BigNumber(route.inAmount.toString())
      .times(new BigNumber(1).plus(slippage))
      .toFixed(0, BigNumber.ROUND_CEIL);
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

/** Fetches the addresses of the given lookup tables; missing tables are omitted. */
export async function resolveLookupTables(
  rpc: Rpc<GetMultipleAccountsApi>,
  lookupTables: Address[]
): Promise<AddressesByLookupTableAddress> {
  if (lookupTables.length === 0) return {};
  const accounts = await fetchJsonParsedAccounts<{ addresses: Address[] }[]>(rpc, lookupTables);
  const addressesByLookupTable: AddressesByLookupTableAddress = {};
  for (const account of accounts) {
    if (!account.exists) continue;
    assertAccountDecoded(account);
    addressesByLookupTable[account.address] = account.data.addresses;
  }
  return addressesByLookupTable;
}
