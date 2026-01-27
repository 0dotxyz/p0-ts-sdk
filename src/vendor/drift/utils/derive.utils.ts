import BN from "bn.js";
import { PublicKey } from "@solana/web3.js";
import { DRIFT_PROGRAM_ID } from "../constants";

export const SEED_DRIFT_STATE = "drift_state";
export const SEED_USER = "user";
export const SEED_USER_STATS = "user_stats";
export const SEED_SPOT_MARKET = "spot_market";
export const SEED_SPOT_MARKET_VAULT = "spot_market_vault";
export const SEED_DRIFT_SIGNER = "drift_signer";

export function getAllDerivedDriftAccounts(marketIndex: number) {
  return {
    driftState: deriveDriftState()[0],
    driftSigner: deriveDriftSigner()[0],
    driftSpotMarket: deriveDriftSpotMarket(marketIndex)[0],
    driftSpotMarketVault: deriveDriftSpotMarketVault(marketIndex)[0],
  };
}

export function deriveDriftState(
  programId: PublicKey = DRIFT_PROGRAM_ID
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(SEED_DRIFT_STATE)],
    programId
  );
}

export function deriveDriftSigner(
  programId: PublicKey = DRIFT_PROGRAM_ID
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(SEED_DRIFT_SIGNER)],
    programId
  );
}

export function deriveDriftUser(
  authority: PublicKey,
  subAccountId: number,
  programId: PublicKey = DRIFT_PROGRAM_ID
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from(SEED_USER),
      authority.toBuffer(),
      new BN(subAccountId).toArrayLike(Buffer, "le", 2),
    ],
    programId
  );
}

export function deriveDriftUserStats(
  authority: PublicKey,
  programId: PublicKey = DRIFT_PROGRAM_ID
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(SEED_USER_STATS), authority.toBuffer()],
    programId
  );
}

export function deriveDriftSpotMarket(
  marketIndex: number,
  programId: PublicKey = DRIFT_PROGRAM_ID
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from(SEED_SPOT_MARKET),
      new BN(marketIndex).toArrayLike(Buffer, "le", 2),
    ],
    programId
  );
}

export function deriveDriftSpotMarketVault(
  marketIndex: number,
  programId: PublicKey = DRIFT_PROGRAM_ID
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from(SEED_SPOT_MARKET_VAULT),
      new BN(marketIndex).toArrayLike(Buffer, "le", 2),
    ],
    programId
  );
}
