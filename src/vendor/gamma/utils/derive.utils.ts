import { PublicKey } from "@solana/web3.js";

import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "~/vendor/spl";

import {
  GAMMA_VAULT_PROGRAM_ID,
  SEED_DEPOSIT_RECEIPT,
  SEED_WITHDRAW_ESCROW,
  SEED_WITHDRAW_RECEIPT,
  SEED_WITHDRAWAL_POLICY,
} from "../constants";

/**
 * Derive the WithdrawalPolicy PDA for a vault.
 * Seeds: ["withdrawal_policy", lpVault]
 */
export function deriveGammaWithdrawalPolicy(
  lpVault: PublicKey,
  programId: PublicKey = GAMMA_VAULT_PROGRAM_ID
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(SEED_WITHDRAWAL_POLICY), lpVault.toBuffer()],
    programId
  );
}

/**
 * Derive the per-user DepositReceipt PDA for a vault.
 * Seeds: ["deposit_receipt", user, lpVault]
 */
export function deriveGammaDepositReceipt(
  user: PublicKey,
  lpVault: PublicKey,
  programId: PublicKey = GAMMA_VAULT_PROGRAM_ID
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(SEED_DEPOSIT_RECEIPT), user.toBuffer(), lpVault.toBuffer()],
    programId
  );
}

/**
 * Derive the per-user WithdrawEscrow PDA for a vault.
 * Seeds: ["withdraw_escrow", user, lpVault]
 */
export function deriveGammaWithdrawEscrow(
  user: PublicKey,
  lpVault: PublicKey,
  programId: PublicKey = GAMMA_VAULT_PROGRAM_ID
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(SEED_WITHDRAW_ESCROW), user.toBuffer(), lpVault.toBuffer()],
    programId
  );
}

/**
 * Derive the per-user WithdrawReceipt PDA for a vault.
 * Seeds: ["withdraw_receipt", user, lpVault]
 */
export function deriveGammaWithdrawReceipt(
  user: PublicKey,
  lpVault: PublicKey,
  programId: PublicKey = GAMMA_VAULT_PROGRAM_ID
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(SEED_WITHDRAW_RECEIPT), user.toBuffer(), lpVault.toBuffer()],
    programId
  );
}

/**
 * Associated token account derivation matching the Gamma program's ATA seeds
 * (`[owner, tokenProgram, mint]`). `allowOwnerOffCurve` is enabled since owners
 * are frequently PDAs (escrow, fee recipient).
 */
export function deriveGammaAta(
  mint: PublicKey,
  owner: PublicKey,
  tokenProgram: PublicKey = TOKEN_PROGRAM_ID
): PublicKey {
  return getAssociatedTokenAddressSync(
    mint,
    owner,
    true,
    tokenProgram,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );
}
