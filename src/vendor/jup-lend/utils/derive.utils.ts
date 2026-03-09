import { PublicKey } from "@solana/web3.js";
import {
  JUP_LEND_PROGRAM_ID,
  JUP_LIQUIDITY_PROGRAM_ID,
  JUP_REWARDS_PROGRAM_ID,
} from "../constants";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "~/vendor/spl";

// Lending Program Seeds
export const SEED_LENDING_ADMIN = "lending_admin";
export const SEED_F_TOKEN_MINT = "f_token_mint";
export const SEED_LENDING = "lending";

// Liquidity Program Seeds
export const SEED_LIQUIDITY = "liquidity";
export const SEED_RESERVE = "reserve";
export const SEED_RATE_MODEL = "rate_model";
export const SEED_USER_SUPPLY_POSITION = "user_supply_position";
export const SEED_USER_CLAIM = "user_claim";

// Rewards Program Seeds
export const SEED_LENDING_REWARDS_RATE_MODEL = "lending_rewards_rate_model";

export function getAllDerivedJupLendAccounts(mint: PublicKey) {
  const [fTokenMint] = deriveJupLendFTokenMint(mint);
  const [lending] = deriveJupLendLending(mint, fTokenMint);
  const [liquidity] = deriveJupLendLiquidity();

  return {
    fTokenMint,
    lendingAdmin: deriveJupLendLendingAdmin()[0],
    supplyTokenReservesLiquidity: deriveJupLendTokenReserve(mint)[0],
    lendingSupplyPositionOnLiquidity: deriveJupLendLiquiditySupplyPositionPda(mint, lending)[0],
    rateModel: deriveJupLendRateModel(mint)[0],
    vault: deriveJupLendLiquidityVaultAta(mint, liquidity),
    liquidity: liquidity,
    rewardsRateModel: deriveJupLendLendingRewardsRateModel(mint)[0],
  };
}

// ============================================================================
// LENDING PROGRAM PDAs
// ============================================================================

export function deriveJupLendLendingPdas(
  underlyingMint: PublicKey,
  lendingProgramId: PublicKey = JUP_LEND_PROGRAM_ID
): {
  lendingAdmin: PublicKey;
  lendingAdminBump: number;
  fTokenMint: PublicKey;
  fTokenMintBump: number;
  lending: PublicKey;
  lendingBump: number;
} {
  const [lendingAdmin, lendingAdminBump] = deriveJupLendLendingAdmin(lendingProgramId);
  const [fTokenMint, fTokenMintBump] = deriveJupLendFTokenMint(underlyingMint, lendingProgramId);
  const [lending, lendingBump] = deriveJupLendLending(underlyingMint, fTokenMint, lendingProgramId);

  return {
    lendingAdmin,
    lendingAdminBump,
    fTokenMint,
    fTokenMintBump,
    lending,
    lendingBump,
  };
}

/**
 * Derive the fToken mint PDA for a given asset.
 * Seeds: ["f_token_mint", asset]
 */
export function deriveJupLendFTokenMint(
  asset: PublicKey,
  lendingProgramId: PublicKey = JUP_LEND_PROGRAM_ID
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(SEED_F_TOKEN_MINT), asset.toBuffer()],
    lendingProgramId
  );
}

/**
 * Derive the Lending state PDA for a given asset.
 * Seeds: ["lending", asset, fTokenMint]
 */
export function deriveJupLendLending(
  asset: PublicKey,
  fTokenMint?: PublicKey,
  lendingProgramId: PublicKey = JUP_LEND_PROGRAM_ID
): [PublicKey, number] {
  const [_fTokenMint] = fTokenMint
    ? [fTokenMint]
    : deriveJupLendFTokenMint(asset, lendingProgramId);

  return PublicKey.findProgramAddressSync(
    [Buffer.from(SEED_LENDING), asset.toBuffer(), _fTokenMint.toBuffer()],
    lendingProgramId
  );
}

/**
 * Derive the LendingAdmin PDA (singleton).
 * Seeds: ["lending_admin"]
 */
export function deriveJupLendLendingAdmin(
  lendingProgramId: PublicKey = JUP_LEND_PROGRAM_ID
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from(SEED_LENDING_ADMIN)], lendingProgramId);
}

// ============================================================================
// REWARDS PROGRAM PDAs
// ============================================================================

/**
 * Derive the LendingRewardsRateModel PDA for a given asset.
 * Seeds: ["lending_rewards_rate_model", asset]
 * Note: This PDA lives on the rewards program, not the lending program.
 */
export function deriveJupLendLendingRewardsRateModel(
  asset: PublicKey,
  rewardsProgramId: PublicKey = JUP_REWARDS_PROGRAM_ID
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(SEED_LENDING_REWARDS_RATE_MODEL), asset.toBuffer()],
    rewardsProgramId
  );
}

// ============================================================================
// LIQUIDITY PROGRAM PDAs
// ============================================================================

/**
 * Derive the TokenReserve PDA for a given asset on the liquidity layer.
 * Seeds: ["reserve", asset]
 */
export function deriveJupLendTokenReserve(
  asset: PublicKey,
  liquidityProgramId: PublicKey = JUP_LIQUIDITY_PROGRAM_ID
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(SEED_RESERVE), asset.toBuffer()],
    liquidityProgramId
  );
}

export function deriveJupLendLiquidityVaultAta(
  underlyingMint: PublicKey,
  liquidityPda: PublicKey,
  tokenProgramId: PublicKey = TOKEN_PROGRAM_ID
): PublicKey {
  return getAssociatedTokenAddressSync(
    underlyingMint,
    liquidityPda,
    true,
    tokenProgramId,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );
}

/**
 * Derive the interest rate model PDA for a given asset on the liquidity layer.
 * Seeds: ["rate_model", asset]
 */
export function deriveJupLendRateModel(
  asset: PublicKey,
  liquidityProgramId: PublicKey = JUP_LIQUIDITY_PROGRAM_ID
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(SEED_RATE_MODEL), asset.toBuffer()],
    liquidityProgramId
  );
}

/**
 * Derive the global Liquidity state PDA (singleton).
 * Seeds: ["liquidity"]
 */
export function deriveJupLendLiquidity(
  liquidityProgramId: PublicKey = JUP_LIQUIDITY_PROGRAM_ID
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from(SEED_LIQUIDITY)], liquidityProgramId);
}

/**
 * Derive the claim account PDA for a given owner and mint on the liquidity program.
 * Seeds: ["user_claim", owner, mint]
 */
export function deriveJupLendClaimAccount(
  owner: PublicKey,
  mint: PublicKey,
  liquidityProgramId: PublicKey = JUP_LIQUIDITY_PROGRAM_ID
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(SEED_USER_CLAIM), owner.toBuffer(), mint.toBuffer()],
    liquidityProgramId
  );
}

export function deriveJupLendLiquiditySupplyPositionPda(
  underlyingMint: PublicKey,
  lendingPda: PublicKey,
  liquidityProgramId: PublicKey = JUP_LIQUIDITY_PROGRAM_ID
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(SEED_USER_SUPPLY_POSITION), underlyingMint.toBuffer(), lendingPda.toBuffer()],
    liquidityProgramId
  );
}
