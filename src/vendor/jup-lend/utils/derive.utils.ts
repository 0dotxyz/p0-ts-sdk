import { PublicKey } from "@solana/web3.js";
import { JUP_LEND_PROGRAM_ID, JUP_LIQUIDITY_PROGRAM_ID, JUP_REWARDS_PROGRAM_ID } from "../constants";

// ============================================================================
// LENDING PROGRAM PDAs
// ============================================================================

/**
 * Derive the fToken mint PDA for a given asset.
 * Seeds: ["f_token_mint", asset]
 */
export function deriveJupFTokenMint(asset: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("f_token_mint"), asset.toBuffer()],
    JUP_LEND_PROGRAM_ID
  );
}

/**
 * Derive the Lending state PDA for a given asset.
 * Seeds: ["lending", asset, fTokenMint]
 */
export function deriveJupLending(asset: PublicKey): [PublicKey, number] {
  const [fTokenMint] = deriveJupFTokenMint(asset);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("lending"), asset.toBuffer(), fTokenMint.toBuffer()],
    JUP_LEND_PROGRAM_ID
  );
}

/**
 * Derive the LendingAdmin PDA (singleton).
 * Seeds: ["lending_admin"]
 */
export function deriveJupLendingAdmin(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("lending_admin")],
    JUP_LEND_PROGRAM_ID
  );
}

// ============================================================================
// REWARDS PROGRAM PDAs
// ============================================================================

/**
 * Derive the LendingRewardsRateModel PDA for a given asset.
 * Seeds: ["lending_rewards_rate_model", asset]
 * Note: This PDA lives on the rewards program, not the lending program.
 */
export function deriveJupLendingRewardsRateModel(asset: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("lending_rewards_rate_model"), asset.toBuffer()],
    JUP_REWARDS_PROGRAM_ID
  );
}

// ============================================================================
// LIQUIDITY PROGRAM PDAs
// ============================================================================

/**
 * Derive the TokenReserve PDA for a given asset on the liquidity layer.
 * Seeds: ["reserve", asset]
 */
export function deriveJupTokenReserve(asset: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("reserve"), asset.toBuffer()],
    JUP_LIQUIDITY_PROGRAM_ID
  );
}

/**
 * Derive the UserSupplyPosition PDA for a given asset and protocol.
 * Seeds: ["user_supply_position", asset, protocol]
 */
export function deriveJupUserSupplyPosition(
  asset: PublicKey,
  protocol: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("user_supply_position"), asset.toBuffer(), protocol.toBuffer()],
    JUP_LIQUIDITY_PROGRAM_ID
  );
}

/**
 * Derive the UserBorrowPosition PDA for a given asset and protocol.
 * Seeds: ["user_borrow_position", asset, protocol]
 */
export function deriveJupUserBorrowPosition(
  asset: PublicKey,
  protocol: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("user_borrow_position"), asset.toBuffer(), protocol.toBuffer()],
    JUP_LIQUIDITY_PROGRAM_ID
  );
}

/**
 * Derive the RateModel PDA for a given asset on the liquidity layer.
 * Seeds: ["rate_model", asset]
 */
export function deriveJupRateModel(asset: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("rate_model"), asset.toBuffer()],
    JUP_LIQUIDITY_PROGRAM_ID
  );
}

/**
 * Derive the Liquidity PDA (singleton).
 * Seeds: ["liquidity"]
 */
export function deriveJupLiquidity(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("liquidity")],
    JUP_LIQUIDITY_PROGRAM_ID
  );
}

/**
 * Derive the ClaimAccount PDA for a given asset and user.
 * Seeds: ["user_claim", user, asset]
 */
export function deriveJupClaimAccount(
  asset: PublicKey,
  user: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("user_claim"), user.toBuffer(), asset.toBuffer()],
    JUP_LIQUIDITY_PROGRAM_ID
  );
}
