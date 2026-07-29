import { Connection, PublicKey } from "@solana/web3.js";

import { USDC_MINT, USDT_MINT, WSOL_MINT } from "~/constants";
import { TransactionBuildingError } from "~/errors";
import { BankType } from "~/services/bank";
import { SolanaTransaction } from "~/services/transaction";
import { TOKEN_PROGRAM_ID } from "~/vendor/spl";

import { MakeSwapDebtTxParams, MarginfiAccountType, SwapQuoteResult } from "../types";
import { BridgeTokenSide, resolveBridgeCandidateBanks } from "./bridge.utils";

/**
 * Shared support for the bridged (double-hop) one-call builders.
 *
 * A **bridge token** is NOT a cross-chain bridge: it is the high-liquidity intermediate token
 * (e.g. USDC or wSOL) a swap is routed *through*. When a direct collateral-swap / debt-swap /
 * loop `A → C` can't be built — the swap doesn't fit one tx (size / account-locks) or has no
 * route — it can still succeed decomposed into `A → bridge` + `bridge → C`, submitted as ONE
 * atomic Jito bundle. The per-flow builders live next to their direct builders
 * (`makeBridgedLoopTx` in `../actions/loop.ts`, `makeBridgedSwapCollateralTx` in
 * `../actions/swap-collateral.ts`, `makeBridgedSwapDebtTx` in `../actions/swap-debt.ts`); this
 * module owns the flow-agnostic routing support: candidate ordering/selection, the
 * candidate-iteration loop (abort / skip-on-failure / conflict surfacing), token-program
 * resolution, and the shared leg context.
 *
 * Candidate *ordering* is product policy: it defaults to {@link DEFAULT_BRIDGE_MINTS} and can be
 * overridden per call via {@link BridgeOpts.bridgeCandidateMints} (e.g. a correlation-aware
 * ordering). Candidate *filtering* (standard-bank resolution, opposite-side conflicts) is
 * mechanical and lives in {@link resolveBridgeCandidateBanks}.
 */

/** Default bridge-token candidates, most-liquid first. */
export const DEFAULT_BRIDGE_MINTS: PublicKey[] = [USDC_MINT, WSOL_MINT, USDT_MINT];

/** Per-call knobs for the bridged fallback of the `makeBridged*Tx` builders. */
export interface BridgeOpts {
  /**
   * Candidate bridge-token mints, highest priority first. Defaults to
   * {@link DEFAULT_BRIDGE_MINTS} (USDC, wSOL, USDT). Source/destination mints are always skipped.
   */
  bridgeCandidateMints?: PublicKey[];
  /** Known token programs by mint (base58) — skips the per-mint RPC owner lookup. */
  tokenProgramByMint?: Map<string, PublicKey>;
  /** Override the bundle-size ceiling (see `composeBridgedSwap`). */
  maxBundleTxs?: number;
  abortSignal?: AbortSignal;
}

/** Result of a `makeBridged*Tx` builder — the direct build's result, or the bridged bundle. */
export interface BridgedTxResult {
  transactions: SolanaTransaction[];
  /** Index of the tx that completes the action (the direct action tx, or the bundle's last leg). */
  actionTxIndex: number;
  quoteResponse: SwapQuoteResult | undefined;
  /** The bridge token's mint — set only when the bridged double-hop path was used. */
  bridgeMint?: PublicKey;
}

/** A mint's token program: the cache (seedable by the caller), else the mint account's owner. */
export async function resolveTokenProgramForMint(
  mint: PublicKey,
  connection: Connection,
  tokenProgramCacheByMint: Map<string, PublicKey>
): Promise<PublicKey> {
  const mintKey = mint.toBase58();
  const cached = tokenProgramCacheByMint.get(mintKey);
  if (cached) return cached;
  const owner = (await connection.getAccountInfo(mint))?.owner ?? TOKEN_PROGRAM_ID;
  tokenProgramCacheByMint.set(mintKey, owner);
  return owner;
}

/**
 * Bridge-token candidate banks for routing `source → bridge → destination`, in priority order,
 * partitioned into usable and conflict-blocked. Source/destination mints are excluded from the
 * candidates (a token can't bridge itself).
 */
export function selectSwapBridges(args: {
  sourceMint: PublicKey;
  destinationMint: PublicKey;
  bankMap: Map<string, BankType>;
  marginfiAccount: MarginfiAccountType;
  bridgeTokenSide: BridgeTokenSide;
  bridgeCandidateMints?: PublicKey[];
}): { usableBridgeBanks: BankType[]; conflictingBridgeBanks: BankType[] } {
  const prioritizedCandidateMints = (args.bridgeCandidateMints ?? DEFAULT_BRIDGE_MINTS).filter(
    (mint) => !mint.equals(args.sourceMint) && !mint.equals(args.destinationMint)
  );
  return resolveBridgeCandidateBanks({
    prioritizedBridgeCandidateMints: prioritizedCandidateMints,
    groupBanks: [...args.bankMap.values()],
    marginfiAccount: args.marginfiAccount,
    bridgeTokenSide: args.bridgeTokenSide,
  });
}

function isAbortError(e: unknown): boolean {
  return e instanceof DOMException && e.name === "AbortError";
}

/**
 * Try each usable bridge-token candidate in priority order until one composes a bundle. A
 * `buildBundleThroughBridge` that returns null or throws (build failure) moves on to the next
 * candidate; abort errors always propagate. When NO candidate is usable but some were dropped
 * solely for an existing opposite-side position, throws
 * `TransactionBuildingError.bridgeConflict` (the caller-facing "close that position" signal);
 * otherwise resolves null and the caller rethrows the direct build's error.
 */
export async function tryBridgeCandidates(args: {
  usableBridgeBanks: BankType[];
  conflictingBridgeBanks: BankType[];
  bridgeTokenSide: BridgeTokenSide;
  abortSignal?: AbortSignal;
  /** Build the two-leg bundle through one candidate bank; null = didn't work, try the next. */
  buildBundleThroughBridge: (bridgeBank: BankType) => Promise<BridgedTxResult | null>;
}): Promise<BridgedTxResult | null> {
  for (const bridgeBank of args.usableBridgeBanks) {
    if (args.abortSignal?.aborted) {
      throw new DOMException("Operation was aborted", "AbortError");
    }
    try {
      const result = await args.buildBundleThroughBridge(bridgeBank);
      if (result) return result;
    } catch (e) {
      if (isAbortError(e)) throw e;
      // this bridge candidate failed to build a leg — try the next one
    }
  }
  if (args.usableBridgeBanks.length === 0 && args.conflictingBridgeBanks.length > 0) {
    throw TransactionBuildingError.bridgeConflict(
      args.conflictingBridgeBanks.map((bank) => ({
        bankAddress: bank.address.toBase58(),
        mint: bank.mint.toBase58(),
        symbol: bank.tokenSymbol,
      })),
      args.bridgeTokenSide
    );
  }
  return null;
}

/** The flow context shared verbatim by both legs of every bridged build. */
export type SharedBridgeLegContext = Pick<
  MakeSwapDebtTxParams,
  | "program"
  | "marginfiAccount"
  | "connection"
  | "bankMap"
  | "oraclePrices"
  | "bankMetadataMap"
  | "assetShareValueMultiplierByBank"
  | "swapOpts"
  | "addressLookupTableAccounts"
  | "overrideInferAccounts"
  | "crossbarUrl"
  | "swapEngineRunner"
>;

export function sharedBridgeLegContext(params: SharedBridgeLegContext): SharedBridgeLegContext {
  return {
    program: params.program,
    marginfiAccount: params.marginfiAccount,
    connection: params.connection,
    bankMap: params.bankMap,
    oraclePrices: params.oraclePrices,
    bankMetadataMap: params.bankMetadataMap,
    assetShareValueMultiplierByBank: params.assetShareValueMultiplierByBank,
    swapOpts: params.swapOpts,
    addressLookupTableAccounts: params.addressLookupTableAccounts,
    overrideInferAccounts: params.overrideInferAccounts,
    crossbarUrl: params.crossbarUrl,
    swapEngineRunner: params.swapEngineRunner,
  };
}
