/**
 * Error codes for transaction building failures
 */
export enum TransactionBuildingErrorCode {
  JUPITER_SWAP_SIZE_EXCEEDED_REPAY = "JUPITER_SWAP_SIZE_EXCEEDED_REPAY",
  JUPITER_SWAP_SIZE_EXCEEDED_LOOP = "JUPITER_SWAP_SIZE_EXCEEDED_LOOP",
  ORACLE_CRANK_FAILED = "ORACLE_CRANK_FAILED",
  KAMINO_RESERVE_NOT_FOUND = "KAMINO_RESERVE_NOT_FOUND",
}

/**
 * Typed details for each error code
 */
export interface TransactionBuildingErrorDetails {
  [TransactionBuildingErrorCode.JUPITER_SWAP_SIZE_EXCEEDED_LOOP]: {
    bytes: number;
    accountKeys: number;
  };
  [TransactionBuildingErrorCode.JUPITER_SWAP_SIZE_EXCEEDED_REPAY]: {
    bytes: number;
    accountKeys: number;
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

  private constructor(
    code: T,
    message: string,
    details: TransactionBuildingErrorDetails[T]
  ) {
    super(message);
    this.name = "TransactionBuildingError";
    this.code = code;
    this.details = details;

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, TransactionBuildingError);
    }
  }

  /**
   * Jupiter swap instruction size exceeds available transaction size
   */
  static jupiterSwapSizeExceededLoop(
    bytes: number,
    accountKeys: number
  ): TransactionBuildingError<TransactionBuildingErrorCode.JUPITER_SWAP_SIZE_EXCEEDED_LOOP> {
    return new TransactionBuildingError(
      TransactionBuildingErrorCode.JUPITER_SWAP_SIZE_EXCEEDED_LOOP,
      "Jupiter swap instruction size exceeds available transaction size",
      { bytes, accountKeys }
    );
  }

  static jupiterSwapSizeExceededRepay(
    bytes: number,
    accountKeys: number
  ): TransactionBuildingError<TransactionBuildingErrorCode.JUPITER_SWAP_SIZE_EXCEEDED_REPAY> {
    return new TransactionBuildingError(
      TransactionBuildingErrorCode.JUPITER_SWAP_SIZE_EXCEEDED_REPAY,
      "Jupiter swap instruction size exceeds available transaction size",
      { bytes, accountKeys }
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
