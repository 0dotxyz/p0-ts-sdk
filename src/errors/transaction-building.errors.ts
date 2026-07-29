/**
 * Error codes for transaction building failures
 */
export enum TransactionBuildingErrorCode {
  SWAP_SIZE_EXCEEDED_LOOP = "SWAP_SIZE_EXCEEDED_LOOP",
  SWAP_SIZE_EXCEEDED_REPAY = "SWAP_SIZE_EXCEEDED_REPAY",
  SWAP_SIZE_EXCEEDED_POSITION_SWAP = "SWAP_SIZE_EXCEEDED_POSITION_SWAP",
  ORACLE_CRANK_FAILED = "ORACLE_CRANK_FAILED",
  KAMINO_RESERVE_NOT_FOUND = "KAMINO_RESERVE_NOT_FOUND",
  DRIFT_STATE_NOT_FOUND = "DRIFT_STATE_NOT_FOUND",
  JUPLEND_STATE_NOT_FOUND = "JUPLEND_STATE_NOT_FOUND",
  SWITCHBOARD_FEED_UPDATE_FAILED = "SWITCHBOARD_FEED_UPDATE_FAILED",
  SWAP_QUOTE_FAILED = "SWAP_QUOTE_FAILED",
  TRANSFER_POSITIONS_INVALID_SELECTION = "TRANSFER_POSITIONS_INVALID_SELECTION",
  TRANSFER_POSITIONS_UNSUPPORTED_BANK = "TRANSFER_POSITIONS_UNSUPPORTED_BANK",
  TRANSFER_POSITIONS_UNSPLITTABLE = "TRANSFER_POSITIONS_UNSPLITTABLE",
  BRIDGE_CONFLICT = "BRIDGE_CONFLICT",
}

/**
 * Typed details for each error code
 */
export interface TransactionBuildingErrorDetails {
  [TransactionBuildingErrorCode.SWAP_SIZE_EXCEEDED_LOOP]: {
    bytes: number;
    accountKeys: number;
    provider?: string;
  };
  [TransactionBuildingErrorCode.SWAP_SIZE_EXCEEDED_REPAY]: {
    bytes: number;
    accountKeys: number;
    provider?: string;
  };
  [TransactionBuildingErrorCode.SWAP_SIZE_EXCEEDED_POSITION_SWAP]: {
    bytes: number;
    accountKeys: number;
    provider?: string;
  };
  [TransactionBuildingErrorCode.ORACLE_CRANK_FAILED]: {
    uncrankableLiabilities: Array<{
      bankAddress: string;
      mint: string;
      symbol?: string;
      reason: string;
    }>;
    uncrankableAssets: Array<{
      bankAddress: string;
      mint: string;
      symbol?: string;
      reason: string;
    }>;
  };
  [TransactionBuildingErrorCode.KAMINO_RESERVE_NOT_FOUND]: {
    bankAddress: string;
    bankMint: string;
    bankSymbol?: string;
  };
  [TransactionBuildingErrorCode.DRIFT_STATE_NOT_FOUND]: {
    bankAddress: string;
    bankMint: string;
    bankSymbol?: string;
  };
  [TransactionBuildingErrorCode.JUPLEND_STATE_NOT_FOUND]: {
    bankAddress: string;
    bankMint: string;
    bankSymbol?: string;
  };
  [TransactionBuildingErrorCode.SWITCHBOARD_FEED_UPDATE_FAILED]: {
    oracleKeys: string[];
    reason: string;
  };
  [TransactionBuildingErrorCode.SWAP_QUOTE_FAILED]: {
    provider: string;
    inputMint: string;
    outputMint: string;
    reason: string;
  };
  [TransactionBuildingErrorCode.TRANSFER_POSITIONS_INVALID_SELECTION]: {
    reason: string;
    bankAddresses: string[];
  };
  [TransactionBuildingErrorCode.TRANSFER_POSITIONS_UNSUPPORTED_BANK]: {
    bankAddress: string;
    assetTag: number;
    bankSymbol?: string;
  };
  [TransactionBuildingErrorCode.TRANSFER_POSITIONS_UNSPLITTABLE]: {
    reason: string;
    sizeBytes?: number;
    accountCount?: number;
  };
  [TransactionBuildingErrorCode.BRIDGE_CONFLICT]: {
    /** Bridge-token candidate banks blocked by an existing opposite-side account position. */
    conflictingBanks: Array<{
      bankAddress: string;
      mint: string;
      symbol?: string;
    }>;
    /** Whether the bridge token would have been held as collateral ("deposit") or debt ("borrow"). */
    bridgeTokenSide: "deposit" | "borrow";
  };
}

/**
 * Error thrown during transaction building in the SDK.
 * Does NOT contain user-facing messages - those are handled in the app layer.
 * Use factory methods to create instances.
 */
export class TransactionBuildingError<
  T extends TransactionBuildingErrorCode = TransactionBuildingErrorCode,
> extends Error {
  readonly code: T;
  readonly details: TransactionBuildingErrorDetails[T];

  private constructor(code: T, message: string, details: TransactionBuildingErrorDetails[T]) {
    super(message);
    this.name = "TransactionBuildingError";
    this.code = code;
    this.details = details;

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, TransactionBuildingError);
    }
  }

  static swapSizeExceededLoop(
    bytes: number,
    accountKeys: number,
    provider?: string
  ): TransactionBuildingError<TransactionBuildingErrorCode.SWAP_SIZE_EXCEEDED_LOOP> {
    return new TransactionBuildingError(
      TransactionBuildingErrorCode.SWAP_SIZE_EXCEEDED_LOOP,
      `${provider ?? "Swap"} instruction size exceeds available transaction size`,
      { bytes, accountKeys, provider }
    );
  }

  static swapSizeExceededRepay(
    bytes: number,
    accountKeys: number,
    provider?: string
  ): TransactionBuildingError<TransactionBuildingErrorCode.SWAP_SIZE_EXCEEDED_REPAY> {
    return new TransactionBuildingError(
      TransactionBuildingErrorCode.SWAP_SIZE_EXCEEDED_REPAY,
      `${provider ?? "Swap"} instruction size exceeds available transaction size`,
      { bytes, accountKeys, provider }
    );
  }

  static swapSizeExceededPositionSwap(
    bytes: number,
    accountKeys: number,
    provider?: string
  ): TransactionBuildingError<TransactionBuildingErrorCode.SWAP_SIZE_EXCEEDED_POSITION_SWAP> {
    return new TransactionBuildingError(
      TransactionBuildingErrorCode.SWAP_SIZE_EXCEEDED_POSITION_SWAP,
      `${provider ?? "Swap"} instruction size exceeds available transaction size`,
      { bytes, accountKeys, provider }
    );
  }

  /**
   * Failed to crank oracles for one or more banks
   */
  static oracleCrankFailed(
    uncrankableLiabilities: Array<{
      bankAddress: string;
      mint: string;
      symbol?: string;
      reason: string;
    }>,
    uncrankableAssets: Array<{
      bankAddress: string;
      mint: string;
      symbol?: string;
      reason: string;
    }>
  ): TransactionBuildingError<TransactionBuildingErrorCode.ORACLE_CRANK_FAILED> {
    const banksList = uncrankableLiabilities
      .concat(uncrankableAssets)
      .map((b) => b.symbol)
      .join(", ");
    return new TransactionBuildingError(
      TransactionBuildingErrorCode.ORACLE_CRANK_FAILED,
      `Failed to crank oracles for: ${banksList}`,
      { uncrankableLiabilities, uncrankableAssets }
    );
  }

  /**
   * Failed to refresh reserves for a bank
   */
  static kaminoReserveNotFound(
    bankAddress: string,
    bankMint: string,
    bankSymbol?: string
  ): TransactionBuildingError<TransactionBuildingErrorCode.KAMINO_RESERVE_NOT_FOUND> {
    return new TransactionBuildingError(
      TransactionBuildingErrorCode.KAMINO_RESERVE_NOT_FOUND,
      `Kamino reserve not found for ${bankSymbol ?? bankMint}`,
      { bankAddress, bankMint, bankSymbol }
    );
  }

  /**
   * Failed to find drift state for a bank
   */
  static driftStateNotFound(
    bankAddress: string,
    bankMint: string,
    bankSymbol?: string
  ): TransactionBuildingError<TransactionBuildingErrorCode.DRIFT_STATE_NOT_FOUND> {
    return new TransactionBuildingError(
      TransactionBuildingErrorCode.DRIFT_STATE_NOT_FOUND,
      `Drift state not found for ${bankSymbol ?? bankMint}`,
      { bankAddress, bankMint, bankSymbol }
    );
  }

  /**
   * Failed to find JupLend state for a bank
   */
  static jupLendStateNotFound(
    bankAddress: string,
    bankMint: string,
    bankSymbol?: string
  ): TransactionBuildingError<TransactionBuildingErrorCode.JUPLEND_STATE_NOT_FOUND> {
    return new TransactionBuildingError(
      TransactionBuildingErrorCode.JUPLEND_STATE_NOT_FOUND,
      `JupLend state not found for ${bankSymbol ?? bankMint}`,
      { bankAddress, bankMint, bankSymbol }
    );
  }

  /**
   * Failed to update Switchboard price feeds
   */
  static switchboardFeedUpdateFailed(
    oracleKeys: string[],
    reason: string
  ): TransactionBuildingError<TransactionBuildingErrorCode.SWITCHBOARD_FEED_UPDATE_FAILED> {
    return new TransactionBuildingError(
      TransactionBuildingErrorCode.SWITCHBOARD_FEED_UPDATE_FAILED,
      `Switchboard feed update failed: ${reason}`,
      { oracleKeys, reason }
    );
  }

  /**
   * Failed to get a swap quote from any provider
   */
  static swapQuoteFailed(
    provider: string,
    inputMint: string,
    outputMint: string,
    reason: string
  ): TransactionBuildingError<TransactionBuildingErrorCode.SWAP_QUOTE_FAILED> {
    return new TransactionBuildingError(
      TransactionBuildingErrorCode.SWAP_QUOTE_FAILED,
      `${provider} swap quote failed for ${inputMint} → ${outputMint}: ${reason}`,
      { provider, inputMint, outputMint, reason }
    );
  }

  /**
   * The requested set of positions to transfer is invalid (inactive bank on the source,
   * destination overlap, capacity/slot conflict, group/authority mismatch, etc.).
   */
  static transferPositionsInvalidSelection(
    reason: string,
    bankAddresses: string[]
  ): TransactionBuildingError<TransactionBuildingErrorCode.TRANSFER_POSITIONS_INVALID_SELECTION> {
    return new TransactionBuildingError(
      TransactionBuildingErrorCode.TRANSFER_POSITIONS_INVALID_SELECTION,
      `Invalid transfer-positions selection: ${reason}`,
      { reason, bankAddresses }
    );
  }

  /**
   * A selected position lives in a bank whose asset tag is not supported by transfer-positions
   * (v1 supports DEFAULT and STAKED only).
   */
  static transferPositionsUnsupportedBank(
    bankAddress: string,
    assetTag: number,
    bankSymbol?: string
  ): TransactionBuildingError<TransactionBuildingErrorCode.TRANSFER_POSITIONS_UNSUPPORTED_BANK> {
    return new TransactionBuildingError(
      TransactionBuildingErrorCode.TRANSFER_POSITIONS_UNSUPPORTED_BANK,
      `Bank ${bankSymbol ?? bankAddress} (asset tag ${assetTag}) is not supported by transfer-positions`,
      { bankAddress, assetTag, bankSymbol }
    );
  }

  /**
   * The built transfer transaction exceeds the v0 size / account-lock limits even at the position
   * cap (most likely several integration positions whose reserve accounts overflow the 64-lock cap).
   * Retry with fewer positions in the selection.
   */
  static transferPositionsUnsplittable(
    reason: string,
    sizeBytes?: number,
    accountCount?: number
  ): TransactionBuildingError<TransactionBuildingErrorCode.TRANSFER_POSITIONS_UNSPLITTABLE> {
    return new TransactionBuildingError(
      TransactionBuildingErrorCode.TRANSFER_POSITIONS_UNSPLITTABLE,
      `Transfer does not fit one transaction: ${reason}`,
      { reason, sizeBytes, accountCount }
    );
  }

  /**
   * A bridged (double-hop) swap could not route because every bridge-token candidate bank
   * conflicts with an existing opposite-side position on the account (marginfi forbids holding an
   * asset and a liability on the same bank).
   */
  static bridgeConflict(
    conflictingBanks: Array<{ bankAddress: string; mint: string; symbol?: string }>,
    bridgeTokenSide: "deposit" | "borrow"
  ): TransactionBuildingError<TransactionBuildingErrorCode.BRIDGE_CONFLICT> {
    const banksList = conflictingBanks.map((c) => c.symbol ?? c.mint).join(", ");
    return new TransactionBuildingError(
      TransactionBuildingErrorCode.BRIDGE_CONFLICT,
      `Every bridge-token candidate conflicts with an existing opposite-side position: ${banksList}`,
      { conflictingBanks, bridgeTokenSide }
    );
  }

  /**
   * Generic escape hatch for custom errors
   */
  static custom<T extends TransactionBuildingErrorCode>(
    code: T,
    message: string,
    details: TransactionBuildingErrorDetails[T]
  ): TransactionBuildingError<T> {
    return new TransactionBuildingError(code, message, details);
  }
}

/** Error codes that mean a single-route swap couldn't be built directly but can be decomposed. */
const DECOMPOSABLE_SWAP_ERROR_CODES = new Set<TransactionBuildingErrorCode>([
  TransactionBuildingErrorCode.SWAP_SIZE_EXCEEDED_LOOP,
  TransactionBuildingErrorCode.SWAP_SIZE_EXCEEDED_REPAY,
  TransactionBuildingErrorCode.SWAP_SIZE_EXCEEDED_POSITION_SWAP,
  TransactionBuildingErrorCode.SWAP_QUOTE_FAILED,
]);

/**
 * Whether a build failure is a *decomposable* swap failure — i.e. the single-route swap couldn't be
 * built (no route/quote, or the route doesn't fit the per-tx size/account limits), but the swap
 * could still succeed when split into two legs through a bridge token (a double-hop).
 *
 * This is the predicate a caller's catch→retry uses to decide whether to attempt a bridged swap
 * (see {@link composeBridgedSwap}). Size overflows surface as `SWAP_SIZE_EXCEEDED_*` and no-route /
 * unquotable failures as `SWAP_QUOTE_FAILED`; the swap engine also classifies an oversized route
 * (which would otherwise throw a raw serialization `RangeError`) as `SWAP_SIZE_EXCEEDED_LOOP`.
 */
export function isDecomposableSwapError(e: unknown): e is TransactionBuildingError {
  return e instanceof TransactionBuildingError && DECOMPOSABLE_SWAP_ERROR_CODES.has(e.code);
}

/**
 * Whether a build failure is a bridged-swap conflict: the direct build failed AND every
 * bridge-token candidate was blocked by an existing opposite-side position on the account.
 * Narrows to the typed details (`conflictingBanks`, `bridgeTokenSide`) so callers can surface a
 * "close that position or pick a different pair" message.
 */
export function isBridgeConflictError(
  e: unknown
): e is TransactionBuildingError<TransactionBuildingErrorCode.BRIDGE_CONFLICT> {
  return (
    e instanceof TransactionBuildingError && e.code === TransactionBuildingErrorCode.BRIDGE_CONFLICT
  );
}
