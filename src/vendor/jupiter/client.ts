// Minimal Jupiter Swap API client — replaces the runtime of @jup-ag/api.
//
// The generated @jup-ag/api client hardcodes the legacy
// `https://quote-api.jup.ag/v6` base URL and ignores a caller-supplied
// basePath, so we reimplement the two endpoints the SDK uses against Jupiter's
// current Swap API (https://dev.jup.ag/docs/swap-api). Only `GET /quote` and
// `POST /swap-instructions` are implemented.

import type {
  QuoteGetRequest,
  QuoteResponse,
  SwapInstructionsResponse,
  SwapRequest,
} from "./types";

// Free tier. Callers with an API key typically override this with the paid
// base `https://api.jup.ag/swap/v1` via `basePath`.
const DEFAULT_BASE_PATH = "https://lite-api.jup.ag/swap/v1";

export interface JupiterClientConfig {
  /** Override the API base URL (e.g. the paid `https://api.jup.ag/swap/v1`). */
  basePath?: string;
  /** API key, sent as the `x-api-key` header. */
  apiKey?: string;
  /** Extra headers applied to every request. */
  headers?: Record<string, string>;
}

export class JupiterApiError extends Error {
  status: number;
  body: string;

  constructor(status: number, body: string) {
    super(`Jupiter API request failed with status ${status}: ${body}`);
    this.name = "JupiterApiError";
    Object.setPrototypeOf(this, JupiterApiError.prototype);
    this.status = status;
    this.body = body;
  }
}

function buildQuoteSearchParams(request: QuoteGetRequest): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(request)) {
    if (value === undefined || value === null) continue;
    // Arrays (dexes/excludeDexes) are comma-separated per the Jupiter spec.
    if (Array.isArray(value)) {
      if (value.length > 0) params.append(key, value.join(","));
      continue;
    }
    params.append(key, String(value));
  }
  return params;
}

export interface JupiterClient {
  quoteGet(request: QuoteGetRequest): Promise<QuoteResponse>;
  swapInstructionsPost(request: { swapRequest: SwapRequest }): Promise<SwapInstructionsResponse>;
}

export function createJupiterClient(config: JupiterClientConfig = {}): JupiterClient {
  const basePath = (config.basePath ?? DEFAULT_BASE_PATH).replace(/\/+$/, "");
  const baseHeaders: Record<string, string> = { ...config.headers };
  if (config.apiKey) baseHeaders["x-api-key"] = config.apiKey;

  const request = async <T>(path: string, init: RequestInit): Promise<T> => {
    const response = await fetch(`${basePath}${path}`, init);
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new JupiterApiError(response.status, body);
    }
    return (await response.json()) as T;
  };

  return {
    quoteGet(quoteRequest) {
      const search = buildQuoteSearchParams(quoteRequest);
      return request<QuoteResponse>(`/quote?${search.toString()}`, {
        method: "GET",
        headers: baseHeaders,
      });
    },
    swapInstructionsPost({ swapRequest }) {
      return request<SwapInstructionsResponse>(`/swap-instructions`, {
        method: "POST",
        headers: { ...baseHeaders, "content-type": "application/json" },
        body: JSON.stringify(swapRequest),
      });
    },
  };
}
