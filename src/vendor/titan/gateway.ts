// Titan Swap V3 gateway (REST) helpers.
//
// Unlike the legacy HTTP proxy path (which posts JSON to an app-side proxy that
// translates to/from msgpack), this talks to the Titan gateway directly using
// the msgpack wire protocol. It is meant to run server-side where the Titan API
// key is available. V3 (`titanSwapVersion: 3`) + `transactionTemplate` let the
// router size routes against the footprint of the rest of the transaction.
//
// Docs: developer-doc/swap-api/guides/transaction-template
//       developer-doc/swap-api/reference/gateway/gateway-quote-swap

import {
  AddressLookupTableAccount,
  PublicKey,
  TransactionInstruction,
} from "@solana/web3.js";
import { Encoder, decode } from "@msgpack/msgpack";

import type { Instruction as TitanWireInstruction, SwapRoute, SwapQuotes } from "./types";

const msgpackEncoder = new Encoder({ useBigInt64: true });

// --- Transaction template (wire format) ---
//
// Single-letter field names, raw bytes for pubkeys + instruction data. See the
// "Transaction Template" guide. `i` = instructions sharing the tx, `a` = ALTs
// already referenced (order is load-bearing), `m` = extra account metas.

export interface TitanTemplateLut {
  /** ALT account address (32 raw bytes). */
  p: Uint8Array;
  /** Addresses stored inside the ALT, in order (32 raw bytes each). */
  a: Uint8Array[];
}

export interface TitanTransactionTemplate {
  i: TitanWireInstruction[];
  a: TitanTemplateLut[];
  m: { p: Uint8Array; s: boolean; w: boolean }[];
}

/** Convert a web3.js instruction into Titan wire format (raw bytes). */
export function instructionToTitanWire(ix: TransactionInstruction): TitanWireInstruction {
  return {
    p: ix.programId.toBytes(),
    a: ix.keys.map((k) => ({
      p: k.pubkey.toBytes(),
      s: k.isSigner,
      w: k.isWritable,
    })),
    d: Uint8Array.from(ix.data),
  };
}

/** Convert a web3.js ALT into Titan wire format (key + inner addresses). */
export function lutToTitanWire(lut: AddressLookupTableAccount): TitanTemplateLut {
  return {
    p: lut.key.toBytes(),
    a: lut.state.addresses.map((a) => a.toBytes()),
  };
}

/**
 * Build a Titan `transactionTemplate` from the surrounding (non-swap) footprint.
 * ALT order is preserved — pass them in the order the final message will use.
 */
export function buildTitanTemplate(footprint: {
  instructions: TransactionInstruction[];
  luts: AddressLookupTableAccount[];
  extraAccountMetas?: { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[];
}): TitanTransactionTemplate {
  return {
    i: footprint.instructions.map(instructionToTitanWire),
    a: footprint.luts.map(lutToTitanWire),
    m: (footprint.extraAccountMetas ?? []).map((m) => ({
      p: m.pubkey.toBytes(),
      s: m.isSigner,
      w: m.isWritable,
    })),
  };
}

/** msgpack-encode then base64 a template for the gateway query string. */
export function encodeTitanTemplate(template: TitanTransactionTemplate): string {
  return Buffer.from(msgpackEncoder.encode(template)).toString("base64");
}

// --- Gateway quote/swap (V3) ---

export interface TitanGatewayQuoteParams {
  /** Gateway base path, e.g. `https://<host>/api/v1`. `/quote/swap` is appended. */
  basePath: string;
  apiKey?: string;
  headers?: Record<string, string>;

  inputMint: string;
  outputMint: string;
  amount: number;
  userPublicKey: string;
  outputAccount: string;
  slippageBps?: number;
  swapMode?: "ExactIn" | "ExactOut";
  dexes?: string[];
  excludeDexes?: string[];
  onlyDirectRoutes?: boolean;
  /** Allowlist of quote providers by id. The gateway has no exclude-list, so to
   *  drop a provider (e.g. Titan-DART) we list the ones we want. */
  providers?: string[];

  /** msgpack+base64 template. Mutually exclusive with the size/account limits
   *  below. Note: sent as a query-string value, so a template that embeds large
   *  ALTs can exceed the gateway's URI limit (414) — prefer the numeric limits
   *  for flashloan footprints that reference big lookup tables. */
  transactionTemplate?: string;

  /** Numeric sizing (small query params; safe for LUT-heavy footprints). */
  addSizeConstraint?: boolean;
  sizeConstraint?: number;
  accountsLimitTotal?: number;
  accountsLimitWritable?: number;

  feeBps?: number;
  feeAccount?: string;
}

export interface TitanGatewayQuoteResponse {
  quotes: { [id: string]: SwapRoute };
  metadata?: { ExpectedWinner?: string };
}

/**
 * Fetch a V3 quote/swap from the Titan gateway and return the best route.
 * Honors the gateway's `ExpectedWinner` when present, otherwise falls back to
 * `selectBestRoute` semantics (max out for ExactIn, min in for ExactOut).
 */
export async function fetchTitanQuoteSwapV3(
  params: TitanGatewayQuoteParams
): Promise<{ route: SwapRoute; raw: TitanGatewayQuoteResponse }> {
  const {
    basePath,
    apiKey,
    headers,
    inputMint,
    outputMint,
    amount,
    userPublicKey,
    outputAccount,
    slippageBps,
    swapMode,
    dexes,
    excludeDexes,
    onlyDirectRoutes,
    providers,
    transactionTemplate,
    addSizeConstraint,
    sizeConstraint,
    accountsLimitTotal,
    accountsLimitWritable,
    feeBps,
    feeAccount,
  } = params;

  const query = new URLSearchParams({
    inputMint,
    outputMint,
    amount: String(amount),
    userPublicKey,
    outputAccount,
    titanSwapVersion: "3",
    simulate: "false",
  });
  if (slippageBps !== undefined) query.set("slippageBps", String(slippageBps));
  if (swapMode) query.set("swapMode", swapMode);
  if (dexes?.length) query.set("dexes", dexes.join(","));
  if (excludeDexes?.length) query.set("excludeDexes", excludeDexes.join(","));
  if (providers?.length) query.set("providers", providers.join(","));
  if (onlyDirectRoutes) query.set("onlyDirectRoutes", "true");
  if (transactionTemplate) {
    query.set("transactionTemplate", transactionTemplate);
  } else {
    // Numeric sizing (mutually exclusive with the template).
    if (addSizeConstraint) query.set("addSizeConstraint", "true");
    if (sizeConstraint !== undefined) query.set("sizeConstraint", String(sizeConstraint));
    if (accountsLimitTotal !== undefined) {
      query.set("accountsLimitTotal", String(accountsLimitTotal));
    }
    if (accountsLimitWritable !== undefined) {
      query.set("accountsLimitWritable", String(accountsLimitWritable));
    }
  }
  if (feeBps !== undefined && feeAccount) {
    query.set("feeBps", String(feeBps));
    query.set("feeAccount", feeAccount);
  }

  const response = await fetch(`${basePath}/quote/swap?${query.toString()}`, {
    method: "GET",
    headers: {
      Accept: "application/vnd.msgpack",
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      ...(headers ?? {}),
    },
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Titan gateway error (${response.status}): ${text || response.statusText}`);
  }

  // The gateway occasionally returns a truncated / non-msgpack body (e.g. an
  // empty "no route" response); decode it defensively so callers get a clean
  // error instead of an opaque msgpack RangeError.
  let raw: TitanGatewayQuoteResponse;
  try {
    raw = decode(new Uint8Array(await response.arrayBuffer())) as TitanGatewayQuoteResponse;
  } catch {
    throw new Error(`Titan gateway returned an undecodable response for ${inputMint} -> ${outputMint}`);
  }

  const route = selectGatewayRoute(raw, swapMode ?? "ExactIn");
  if (!route) {
    throw new Error(`No Titan V3 route found for ${inputMint} -> ${outputMint}`);
  }
  return { route, raw };
}

/**
 * A route is only usable if it quotes a real amount. Titan occasionally returns
 * a single `Titan-DART` (RFQ / private-swap) route that quotes `outAmount: 0` —
 * DART settles via a separate auction/signature and isn't composable inside a
 * flashloan, so we treat zero-amount routes as non-viable.
 */
function isViableRoute(route: SwapRoute, swapMode: "ExactIn" | "ExactOut"): boolean {
  return swapMode === "ExactIn" ? route.outAmount > 0 : route.inAmount > 0;
}

/**
 * Pick the best usable route from a quotes map, honoring Titan's
 * `ExpectedWinner` when present and skipping non-viable (zero-amount) routes.
 * Shared by the gateway REST path and the WebSocket adapter.
 */
export function selectGatewayRoute(
  raw: TitanGatewayQuoteResponse,
  swapMode: "ExactIn" | "ExactOut"
): SwapRoute | null {
  const viable = Object.values(raw.quotes ?? {}).filter((r) => isViableRoute(r, swapMode));
  if (viable.length === 0) return null;

  // Honor Titan's recommended winner only when it is itself a viable route.
  const winnerId = raw.metadata?.ExpectedWinner;
  if (winnerId) {
    const winner = raw.quotes[winnerId];
    if (winner && isViableRoute(winner, swapMode)) return winner;
  }

  return viable.reduce((best, route) =>
    swapMode === "ExactIn"
      ? route.outAmount > best.outAmount
        ? route
        : best
      : route.inAmount < best.inAmount
        ? route
        : best
  );
}

/** Deserialize a Titan wire instruction (raw bytes) into a web3.js instruction. */
export function deserializeTitanWireInstruction(
  ix: TitanWireInstruction
): TransactionInstruction {
  return new TransactionInstruction({
    programId: new PublicKey(ix.p),
    keys: ix.a.map((account) => ({
      pubkey: new PublicKey(account.p),
      isSigner: account.s,
      isWritable: account.w,
    })),
    data: Buffer.from(ix.d),
  });
}

/** Reuse the SwapQuotes type so callers can share route-selection helpers. */
export type { SwapQuotes };
