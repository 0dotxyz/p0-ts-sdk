import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";

import {
  V1Client,
  SwapMode,
  SwapVersion,
  buildTitanTemplate,
  buildSwapQuoteResult,
  deserializeTitanWireInstruction,
  resolveLookupTables,
  selectGatewayRoute,
  type SwapQuotes,
} from "~/vendor/titan";

import { SwapApiConfig, SwapProvider } from "~/services/account/types";
import { checkTitanFeeAccount } from "~/services/account/utils/titan.utils";
import { ProviderSwapRoute, SwapAdapter, SwapEngineRequest } from "../types";

/**
 * Quote providers we let Titan route through. We intentionally exclude the
 * `Titan-DART` (RFQ / private-swap) provider — it settles via a separate
 * auction/signature and isn't composable inside our flashloan transaction.
 * The router has no exclude-list, only a `providers` allowlist, so we list the
 * composable aggregators by id.
 *
 * TODO: switch to an exclude mechanism once Titan exposes one (allowlisting by
 * id silently drops any provider Titan adds in the future).
 */
const TITAN_COMPOSABLE_PROVIDERS = ["Titan", "Metis", "Okx"];

/**
 * Budget for both the WS connect and the first-quote read. The stream pushes the
 * full provider `quotes` map in every update, so a single read is enough.
 */
const TITAN_WS_TIMEOUT_MS = 5_000;

/**
 * Titan Swap V3 adapter. Quotes over the Titan Direct **WebSocket** so the full
 * flashloan footprint `transactionTemplate` (the non-swap inner ixs + loop ALTs)
 * can be sent inline as a native msgpack object. The equivalent gateway GET
 * sends the template as a query-string value, which overflows the URI limit
 * (HTTP 414) once the loop's large lookup tables are included.
 *
 * The template is sizing-only: the surrounding instructions already exist in the
 * assembled flashloan tx (the engine splices the returned route into the swap
 * slot), so we do not re-emit the template's instructions.
 */
async function buildCandidates(
  req: SwapEngineRequest,
  apiConfig?: SwapApiConfig
): Promise<ProviderSwapRoute[]> {
  const wsUrl = apiConfig?.wsUrl;
  if (!wsUrl) throw new Error("Titan WebSocket URL is required (apiConfig.wsUrl)");
  const footprint = req.footprint;
  if (!footprint) throw new Error("Titan buildCandidates requires a footprint");

  const { fee, feeAccount } = await resolveFee(req);

  // Full-footprint template: the non-swap inner ixs + (optional) FL wrapper + loop LUTs.
  const template = buildTitanTemplate({
    instructions: [...(footprint.wrapperInstructions ?? []), ...footprint.instructions],
    luts: footprint.luts,
  });

  const client = await withTimeout(
    V1Client.connect(authedWsUrl(wsUrl, apiConfig?.apiKey)),
    TITAN_WS_TIMEOUT_MS,
    "Titan WebSocket connect timed out"
  );

  let streamId: number | undefined;
  try {
    const { stream, streamId: id } = await client.newSwapQuoteStream({
      swap: {
        inputMint: new PublicKey(req.inputMint).toBytes(),
        outputMint: new PublicKey(req.outputMint).toBytes(),
        amount: req.amountNative,
        swapMode: SwapMode.ExactIn,
        slippageBps: req.slippageBps,
        onlyDirectRoutes: req.directRoutesOnly,
        providers: TITAN_COMPOSABLE_PROVIDERS,
        transactionTemplate: template,
      },
      transaction: {
        userPublicKey: req.taker.toBytes(),
        outputAccount: req.destinationTokenAccount.toBytes(),
        titanSwapVersion: SwapVersion.V3,
        ...(fee !== undefined && feeAccount
          ? { feeBps: fee, feeAccount: new PublicKey(feeAccount).toBytes() }
          : {}),
      },
      update: { num_quotes: 3 },
    });
    streamId = id;

    const reader = stream.getReader();
    let swapQuotes: SwapQuotes;
    try {
      const { value, done } = await withTimeout(
        reader.read(),
        TITAN_WS_TIMEOUT_MS,
        "Titan WebSocket quote timed out"
      );
      if (done || !value) throw new Error("Titan swap quote stream ended without data");
      swapQuotes = value as SwapQuotes;
    } finally {
      reader.releaseLock();
    }

    const route = selectGatewayRoute(
      { quotes: swapQuotes.quotes, metadata: swapQuotes.metadata },
      "ExactIn"
    );
    if (!route) {
      throw new Error(`No Titan V3 route found for ${req.inputMint} -> ${req.outputMint}`);
    }

    const swapInstructions = route.instructions.map(deserializeTitanWireInstruction);
    const lutPubkeys = route.addressLookupTables.map((bytes) => new PublicKey(bytes));
    const luts = await resolveLookupTables(req.connection, lutPubkeys);

    const quote = buildSwapQuoteResult(route, "ExactIn");

    return [
      {
        provider: SwapProvider.TITAN,
        swapInstructions,
        setupInstructions: [],
        luts,
        outAmountNative: new BN(quote.outAmount),
        otherAmountThresholdNative: new BN(quote.otherAmountThreshold),
        quoteResult: { ...quote, provider: SwapProvider.TITAN },
        label: "titan:v3",
      },
    ];
  } finally {
    if (streamId !== undefined && !client.closed) {
      await client.stopStream(streamId).catch(() => {});
    }
    if (!client.closed) await client.close();
  }
}

/** Only attach a platform fee when the referral ATA exists and a fee is requested. */
async function resolveFee(
  req: SwapEngineRequest
): Promise<{ fee?: number; feeAccount?: string }> {
  if (!req.platformFeeBps) return {};
  // ExactIn: fee taken on the output mint.
  const feeMint = new PublicKey(req.outputMint);
  const { feeAccount, hasFeeAccount } = await checkTitanFeeAccount(req.connection, feeMint);
  if (!hasFeeAccount) {
    console.warn("[titan] fee account ATA missing, disabling platform fee");
    return {};
  }
  return { fee: req.platformFeeBps, feeAccount: feeAccount.toBase58() };
}

/** Append the JWT as an `auth` query param (works with the bare `connect(url)`). */
function authedWsUrl(wsUrl: string, apiKey?: string): string {
  if (!apiKey) return wsUrl;
  const sep = wsUrl.includes("?") ? "&" : "?";
  return `${wsUrl}${sep}auth=${encodeURIComponent(apiKey)}`;
}

/** Reject if `promise` doesn't settle within `ms`. */
function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export const titanAdapter: SwapAdapter = {
  name: SwapProvider.TITAN,
  supportsBuild: true,
  buildCandidates,
};
