/**
 * Size the borrow amount for a debt swap from a market-price calculation.
 *
 * Provider ExactOut quotes are unreliable and Jupiter Router `/build` is
 * ExactIn-only, so instead of asking a provider "how much input for this output",
 * we borrow the no-slippage market equivalent of the repay target plus a slippage
 * buffer, then route ExactIn. For a full repay we add a little extra so a slight
 * shortfall doesn't fail the repayAll; for a partial repay we keep the buffer
 * tight to avoid minting more new debt than necessary.
 */
export const DEFAULT_REPAY_ALL_EXTRA_BUFFER_BPS = 50;
const DEFAULT_SLIPPAGE_BPS = 50;

export function computeBorrowEstimateForRepay(params: {
  /** Target repay amount in UI units of the repay token. */
  repayTargetUi: number;
  /** Market price (USD/UI) of the repay token. */
  repayMarketPrice: number;
  /** Market price (USD/UI) of the borrow token. */
  borrowMarketPrice: number;
  slippageBps?: number;
  /** Whether this repays the whole position (adds the extra buffer). */
  isRepayAll: boolean;
  repayAllExtraBufferBps?: number;
}): number {
  const {
    repayTargetUi,
    repayMarketPrice,
    borrowMarketPrice,
    slippageBps = DEFAULT_SLIPPAGE_BPS,
    isRepayAll,
    repayAllExtraBufferBps = DEFAULT_REPAY_ALL_EXTRA_BUFFER_BPS,
  } = params;

  if (borrowMarketPrice <= 0) {
    throw new Error("computeBorrowEstimateForRepay: borrowMarketPrice must be positive");
  }

  const bufferBps = slippageBps + (isRepayAll ? repayAllExtraBufferBps : 0);
  return ((repayTargetUi * repayMarketPrice) / borrowMarketPrice) * (1 + bufferBps / 10000);
}
