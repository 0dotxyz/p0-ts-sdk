/**
 * Shared configuration for examples
 *
 * Loads configuration from environment variables.
 * Copy .env.example to .env and fill in your values.
 */

import { config } from "dotenv";
import { address, createSolanaRpc, type Address } from "@solana/kit";
import path from "path";
import { fileURLToPath } from "url";

import {
  SwapProvider,
  type Environment,
  type Project0Config,
  type SwapProviderConfig,
  type SwapProviderEntry,
} from "../src";

// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env file from examples directory
config({ path: path.join(__dirname, ".env") });

/**
 * Get required environment variable or throw error
 */
function getEnvVar(key: string, required: boolean = true): string {
  const value = process.env[key];
  if (!value && required) {
    throw new Error(
      `Missing required environment variable: ${key}\n` +
        `Please copy .env.example to .env and fill in your values.`
    );
  }
  return value || "";
}

/**
 * Solana RPC client and its endpoint. Bundle simulation (`simulateBundle`) and the client's
 * health-cache simulation need an endpoint that supports Jito's `simulateBundle`.
 */
export function getRpc() {
  const rpcEndpoint = getEnvVar("SOLANA_RPC_URL");
  return { rpc: createSolanaRpc(rpcEndpoint), rpcEndpoint };
}

/**
 * Marginfi configuration
 */
export function getMarginfiConfig(): Project0Config {
  return {
    environment: getEnvVar("MARGINFI_ENVIRONMENT") as Environment,
    groupPk: address(getEnvVar("MARGINFI_GROUP_ADDRESS")),
    programId: address(getEnvVar("MARGINFI_PROGRAM_ID")),
  };
}

/**
 * User's marginfi account address
 */
export function getAccountAddress(): Address {
  return address(getEnvVar("MARGINFI_ACCOUNT_ADDRESS"));
}

/**
 * User's wallet address (for simulation/read-only operations)
 */
export function getWalletAddress(): Address {
  return address(getEnvVar("WALLET_ADDRESS"));
}

/**
 * Common mint addresses
 */
export const MINTS = {
  USDC: address("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"),
  USDT: address("Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB"),
  SOL: address("So11111111111111111111111111111111111111112"),
  JITOSOL: address("J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn"),
  MSOL: address("mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So"),
  BSOL: address("bSo13r4TkiE4KumL71LsHTPpL2euBYLFx6h9HP3piy1"),
};

/** Universal bridge mints for double-hop swaps (mirrors the app's UNIVERSAL_BRIDGES). */
export const UNIVERSAL_BRIDGE_MINTS = [MINTS.USDC, MINTS.SOL, MINTS.USDT, MINTS.JITOSOL];

/**
 * Builds the multi-provider swap-engine config the SDK swap builders expect (`swapOpts.swapConfig`),
 * mirroring the P0 app's default: TITAN primary with a JUPITER fallback. The builders run
 * `runSwapEngine` in-process with `provider` + `fallbackProviders` as co-equal candidates and pick
 * the best route that fits the flashloan transaction. Only providers you supply credentials for are
 * queried; with no Titan creds it falls back to Jupiter only.
 *
 * Env vars:
 *   TITAN_GATEWAY_URL      REST gateway base, e.g. https://<host>/api/v1
 *   TITAN_API_ENDPOINT     alternative to TITAN_GATEWAY_URL — a bare host is normalized to
 *                          https://<host>/api/v1 (matches the app)
 *   TITAN_WS_URL           Titan V3 quotes over WS, e.g. wss://<host>/api/v1/ws — derived from the
 *                          base when omitted
 *   TITAN_API_KEY          Titan JWT (used for REST + WS)
 *   JUPITER_API_KEY        omit to use the public, rate-limited endpoint
 *   JUPITER_BASE_PATH      default https://api.jup.ag/swap/v1
 *   SWAP_SLIPPAGE_MODE     "DYNAMIC" | "FIXED"  (default DYNAMIC)
 *   SWAP_SLIPPAGE_BPS      default 50
 *   SWAP_PLATFORM_FEE_BPS  default 0
 *   SWAP_DIRECT_ROUTES_ONLY "true" | "false"   (default false)
 */
export function getSwapConfig(): SwapProviderConfig {
  const slippageMode = (getEnvVar("SWAP_SLIPPAGE_MODE", false) || "DYNAMIC") as
    | "DYNAMIC"
    | "FIXED";
  const slippageBps = Number(getEnvVar("SWAP_SLIPPAGE_BPS", false) || "50");
  const platformFeeBps = Number(getEnvVar("SWAP_PLATFORM_FEE_BPS", false) || "0");
  const directRoutesOnly = (getEnvVar("SWAP_DIRECT_ROUTES_ONLY", false) || "false") === "true";
  const common = { slippageMode, slippageBps, platformFeeBps, directRoutesOnly };

  const jupiterEntry: SwapProviderEntry = {
    provider: SwapProvider.JUPITER,
    apiConfig: {
      basePath: getEnvVar("JUPITER_BASE_PATH", false) || "https://api.jup.ag/swap/v1",
      apiKey: getEnvVar("JUPITER_API_KEY", false) || undefined,
    },
  };

  // TITAN primary + JUPITER fallback (the app default) when Titan creds are present. Accept either
  // a full gateway URL or a bare host (TITAN_API_ENDPOINT), normalized like the app.
  const titanRaw = getEnvVar("TITAN_GATEWAY_URL", false) || getEnvVar("TITAN_API_ENDPOINT", false);
  if (titanRaw) {
    const basePath = normalizeTitanBase(titanRaw);
    return {
      provider: SwapProvider.TITAN,
      ...common,
      apiConfig: {
        basePath,
        wsUrl: getEnvVar("TITAN_WS_URL", false) || deriveTitanWs(basePath),
        apiKey: getEnvVar("TITAN_API_KEY", false) || undefined,
      },
      fallbackProviders: [jupiterEntry],
    };
  }

  // Otherwise Jupiter only.
  return { provider: SwapProvider.JUPITER, ...common, apiConfig: jupiterEntry.apiConfig };
}

/** Normalize a Titan gateway value (full URL or bare host) to `https://<host>/api/v1`. */
function normalizeTitanBase(raw: string): string {
  let s = raw.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//.test(s)) s = `https://${s}`;
  if (!s.endsWith("/api/v1")) s = `${s}/api/v1`;
  return s;
}

/** Derive the Titan V3 WS endpoint from the REST base: `https://h/api/v1` → `wss://h/api/v1/ws`. */
function deriveTitanWs(base: string): string {
  return `${base.replace(/^http/, "ws")}/ws`;
}
