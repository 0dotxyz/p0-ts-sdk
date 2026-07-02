import { KaminoFarmState, KaminoFarmStateJSON } from "../../types";

/**
 * Serialize a Kamino FarmState to its JSON DTO.
 *
 * The parameter is typed as the curated {@link KaminoFarmState}, so a
 * freshly decoded `FarmStateRaw` is accepted structurally and trimmed
 * down to the curated shape here.
 */
export function kaminoFarmStateToDto(
  farmState: KaminoFarmState
): KaminoFarmStateJSON {
  return {
    token: {
      mint: farmState.token.mint.toBase58(),
      decimals: farmState.token.decimals.toString(),
    },
    rewardInfos: farmState.rewardInfos.map((item) => ({
      token: {
        mint: item.token.mint.toBase58(),
        decimals: item.token.decimals.toString(),
      },
      rewardsPerSecondDecimals: item.rewardsPerSecondDecimals,
      rewardScheduleCurve: {
        points: item.rewardScheduleCurve.points.map((p) => ({
          tsStart: p.tsStart.toString(),
          rewardPerTimeUnit: p.rewardPerTimeUnit.toString(),
        })),
      },
    })),
  };
}
