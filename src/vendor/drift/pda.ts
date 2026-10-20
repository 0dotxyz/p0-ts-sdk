import {
  getAddressEncoder,
  getProgramDerivedAddress,
  getU16Encoder,
  type Address,
  type ProgramDerivedAddress,
} from "@solana/kit";

import { DRIFT_PROGRAM_ADDRESS } from "~/generated/drift";

/** Drift `State` PDA. */
export function deriveDriftState(): Promise<ProgramDerivedAddress> {
  return getProgramDerivedAddress({
    programAddress: DRIFT_PROGRAM_ADDRESS,
    seeds: ["drift_state"],
  });
}

/** Drift signer PDA (owns spot market vaults). */
export function deriveDriftSigner(): Promise<ProgramDerivedAddress> {
  return getProgramDerivedAddress({
    programAddress: DRIFT_PROGRAM_ADDRESS,
    seeds: ["drift_signer"],
  });
}

/** Drift `User` PDA of `authority` sub-account `subAccountId`. */
export function deriveDriftUser(
  authority: Address,
  subAccountId: number
): Promise<ProgramDerivedAddress> {
  return getProgramDerivedAddress({
    programAddress: DRIFT_PROGRAM_ADDRESS,
    seeds: ["user", getAddressEncoder().encode(authority), getU16Encoder().encode(subAccountId)],
  });
}

/** Drift `UserStats` PDA of `authority`. */
export function deriveDriftUserStats(authority: Address): Promise<ProgramDerivedAddress> {
  return getProgramDerivedAddress({
    programAddress: DRIFT_PROGRAM_ADDRESS,
    seeds: ["user_stats", getAddressEncoder().encode(authority)],
  });
}

/** Drift `SpotMarket` PDA of `marketIndex`. */
export function deriveDriftSpotMarket(marketIndex: number): Promise<ProgramDerivedAddress> {
  return getProgramDerivedAddress({
    programAddress: DRIFT_PROGRAM_ADDRESS,
    seeds: ["spot_market", getU16Encoder().encode(marketIndex)],
  });
}

/** Drift spot market token vault PDA of `marketIndex`. */
export function deriveDriftSpotMarketVault(marketIndex: number): Promise<ProgramDerivedAddress> {
  return getProgramDerivedAddress({
    programAddress: DRIFT_PROGRAM_ADDRESS,
    seeds: ["spot_market_vault", getU16Encoder().encode(marketIndex)],
  });
}

/** State, signer, spot market and spot market vault of `marketIndex`. */
export async function getAllDerivedDriftAccounts(marketIndex: number) {
  const [[driftState], [driftSigner], [driftSpotMarket], [driftSpotMarketVault]] =
    await Promise.all([
      deriveDriftState(),
      deriveDriftSigner(),
      deriveDriftSpotMarket(marketIndex),
      deriveDriftSpotMarketVault(marketIndex),
    ]);
  return { driftState, driftSigner, driftSpotMarket, driftSpotMarketVault };
}
