import {
  address,
  getAddressEncoder,
  getProgramDerivedAddress,
  type Address,
  type ProgramDerivedAddress,
} from "@solana/kit";
import { findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";

import { findFTokenMintPda, findLendingAdminPda, findLendingPda } from "~/generated/jup-lend";
import {
  findLiquidityPda,
  findRateModelPda,
  findTokenReservePda,
  findUserSupplyPositionPda,
} from "~/generated/jup-lend-liquidity";

/** JupLend rewards rate model program (no IDL client; only its PDA is needed). */
export const JUP_REWARDS_PROGRAM_ADDRESS = address("jup7TthsMgcR9Y3L277b8Eo9uboVSmu1utkuXHNUKar");

/** `LendingRewardsRateModel` PDA of `mint`, owned by the rewards program. */
export function deriveJupLendLendingRewardsRateModel(
  mint: Address
): Promise<ProgramDerivedAddress> {
  return getProgramDerivedAddress({
    programAddress: JUP_REWARDS_PROGRAM_ADDRESS,
    seeds: ["lending_rewards_rate_model", getAddressEncoder().encode(mint)],
  });
}

/**
 * All JupLend accounts a deposit/withdraw of `mint` needs, derived locally. `tokenProgram` is the
 * mint's token program (for the liquidity vault ATA).
 */
export async function getAllDerivedJupLendAccounts(
  mint: Address,
  tokenProgram: Address = TOKEN_PROGRAM_ADDRESS
) {
  const [[fTokenMint], [liquidity]] = await Promise.all([
    findFTokenMintPda({ mint }),
    findLiquidityPda(),
  ]);
  const [
    [lending],
    [lendingAdmin],
    [supplyTokenReservesLiquidity],
    [rateModel],
    [vault],
    [rewardsRateModel],
  ] = await Promise.all([
    findLendingPda({ mint, fTokenMint }),
    findLendingAdminPda(),
    findTokenReservePda({ mint }),
    findRateModelPda({ mint }),
    findAssociatedTokenPda({ owner: liquidity, tokenProgram, mint }),
    deriveJupLendLendingRewardsRateModel(mint),
  ]);
  const [lendingSupplyPositionOnLiquidity] = await findUserSupplyPositionPda({
    supplyMint: mint,
    protocol: lending,
  });

  return {
    fTokenMint,
    lendingAdmin,
    supplyTokenReservesLiquidity,
    lendingSupplyPositionOnLiquidity,
    rateModel,
    vault,
    liquidity,
    rewardsRateModel,
  };
}
