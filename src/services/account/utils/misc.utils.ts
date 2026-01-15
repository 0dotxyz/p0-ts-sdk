function floor(value: number, decimals: number): number {
  return Math.floor(value * 10 ** decimals) / 10 ** decimals;
}

function ceil(value: number, decimals: number): number {
  return Math.ceil(value * 10 ** decimals) / 10 ** decimals;
}

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
  const closePositionTokenAmount = computeClosePositionTokenAmount(position, mintDecimals);
  return amount >= closePositionTokenAmount;
}
