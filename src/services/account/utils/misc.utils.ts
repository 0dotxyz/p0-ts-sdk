import { ceil, floor } from "@mrgnlabs/mrgn-common";

export function computeClosePositionTokenAmount(
  position: { amount: number; isLending: boolean },
  mintDecimals: number
): number {
  const closePositionTokenAmount = position.isLending
    ? floor(position.amount, mintDecimals)
    : ceil(position.amount, mintDecimals);
  return closePositionTokenAmount;
}

export function isWholePosition(
  position: { amount: number; isLending: boolean },
  amount: number,
  mintDecimals: number
): boolean {
  const closePositionTokenAmount = computeClosePositionTokenAmount(
    position,
    mintDecimals
  );
  return amount >= closePositionTokenAmount;
}
