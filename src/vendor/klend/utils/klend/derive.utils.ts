import { PublicKey } from "@solana/web3.js";
import { KLEND_PROGRAM_ID } from "../../constants";

export const SEED_LENDING_MARKET_AUTH = "lma";
export const SEED_RESERVE_LIQ_SUPPLY = "reserve_liq_supply";
export const SEED_FEE_RECEIVER = "fee_receiver";
export const SEED_RESERVE_COLL_MINT = "reserve_coll_mint";
export const SEED_RESERVE_COLL_SUPPLY = "reserve_coll_supply";
export const SEED_BASE_REFERRER_TOKEN_STATE = "referrer_acc";
export const SEED_BASE_USER_METADATA = "user_meta";
export const SEED_BASE_REFERRER_STATE = "ref_state";
export const SEED_BASE_SHORT_URL = "short_url";
export const SEED_USER_STATE = "user";

export function getAllDerivedKaminoAccounts(
  lendingMarket: PublicKey,
  reserveLiquidityMint: PublicKey
) {
  return {
    lendingMarketAuthority: deriveLendingMarketAuthority(lendingMarket)[0],
    reserveLiquiditySupply: deriveReserveLiquiditySupply(
      lendingMarket,
      reserveLiquidityMint
    )[0],
    reserveCollateralMint: deriveReserveCollateralMint(
      lendingMarket,
      reserveLiquidityMint
    )[0],
    reserveDestinationDepositCollateral: deriveReserveCollateralSupply(
      lendingMarket,
      reserveLiquidityMint
    )[0],
  };
}

export function deriveLendingMarketAuthority(
  lendingMarket: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(SEED_LENDING_MARKET_AUTH), lendingMarket.toBuffer()],
    KLEND_PROGRAM_ID
  );
}

export function deriveReserveLiquiditySupply(
  lendingMarket: PublicKey,
  reserveLiquidityMint: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from(SEED_RESERVE_LIQ_SUPPLY),
      lendingMarket.toBuffer(),
      reserveLiquidityMint.toBuffer(),
    ],
    KLEND_PROGRAM_ID
  );
}

export function deriveFeeReceiver(
  lendingMarket: PublicKey,
  reserveLiquidityMint: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from(SEED_FEE_RECEIVER),
      lendingMarket.toBuffer(),
      reserveLiquidityMint.toBuffer(),
    ],
    KLEND_PROGRAM_ID
  );
}

export function deriveReserveCollateralMint(
  lendingMarket: PublicKey,
  reserveLiquidityMint: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from(SEED_RESERVE_COLL_MINT),
      lendingMarket.toBuffer(),
      reserveLiquidityMint.toBuffer(),
    ],
    KLEND_PROGRAM_ID
  );
}

export function deriveReserveCollateralSupply(
  lendingMarket: PublicKey,
  reserveLiquidityMint: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from(SEED_RESERVE_COLL_SUPPLY),
      lendingMarket.toBuffer(),
      reserveLiquidityMint.toBuffer(),
    ],
    KLEND_PROGRAM_ID
  );
}

export function deriveReferrerTokenState(
  referrer: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(SEED_BASE_REFERRER_TOKEN_STATE), referrer.toBuffer()],
    KLEND_PROGRAM_ID
  );
}

export function deriveUserMetadata(user: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(SEED_BASE_USER_METADATA), user.toBuffer()],
    KLEND_PROGRAM_ID
  );
}

export function deriveReferrerState(user: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(SEED_BASE_REFERRER_STATE), user.toBuffer()],
    KLEND_PROGRAM_ID
  );
}

export function deriveShortUrl(identifier: Buffer): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(SEED_BASE_SHORT_URL), identifier],
    KLEND_PROGRAM_ID
  );
}

/**
 * Typically the obligation for each bank will have tag and id = 0
 * @param ownerPublicKey
 * @param marketPublicKey
 * @param programId - Default KLEND_PROGRAM_ID
 * @param seed1AccountKey - Default PublicKey.default
 * @param seed2AccountKey - Default PublicKey.default
 * @param tag - Default 0
 * @param id - Default 0
 * @returns
 */
export const deriveBaseObligation = (
  ownerPublicKey: PublicKey,
  marketPublicKey: PublicKey,
  programId: PublicKey = KLEND_PROGRAM_ID,
  seed1AccountKey: PublicKey = PublicKey.default,
  seed2AccountKey: PublicKey = PublicKey.default,
  tag: number = 0,
  id: number = 0
) => {
  return deriveObligation(
    programId,
    tag,
    id,
    ownerPublicKey,
    marketPublicKey,
    seed1AccountKey,
    seed2AccountKey
  );
};

export const deriveObligation = (
  programId: PublicKey,
  tag: number,
  id: number,
  ownerPublicKey: PublicKey,
  marketPublicKey: PublicKey,
  seed1AccountKey: PublicKey,
  seed2AccountKey: PublicKey
) => {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from([tag]),
      Buffer.from([id]),
      ownerPublicKey.toBuffer(),
      marketPublicKey.toBuffer(),
      seed1AccountKey.toBuffer(),
      seed2AccountKey.toBuffer(),
    ],
    programId
  );
};

/**
 * Somewhat contrary to the name, this is the rewards state of the farms program for an obligation
 * (like one owned by a bank), and has nothing to do with "users" in a margin context.
 * @param programId
 * @param farmState
 * @param obligation
 * @returns
 */
export function deriveUserState(
  programId: PublicKey,
  farmState: PublicKey,
  obligation: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(SEED_USER_STATE), farmState.toBuffer(), obligation.toBuffer()],
    programId
  );
}
