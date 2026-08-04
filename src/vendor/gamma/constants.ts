import { PublicKey } from "@solana/web3.js";

/**
 * Gamma Protocol vault program — LP vaults with instant deposits, escrow
 * withdrawals. The production P0 vaults live under the upstream Gamma
 * program; the on-chain vault, withdrawal-policy, deposit-receipt and
 * withdraw-receipt accounts all live under this program, so all PDAs and
 * instruction targets must derive from it.
 */
export const GAMMA_VAULT_PROGRAM_ID = new PublicKey(
  "GaMmanX9i4jGmqDZZD2tbD6B2v9p21btenPneMXnTczV"
);

// LP vault PDA seeds
export const SEED_WITHDRAWAL_POLICY = "withdrawal_policy";
export const SEED_DEPOSIT_POLICY = "deposit_policy";
export const SEED_DEPOSIT_RECEIPT = "deposit_receipt";
export const SEED_WITHDRAW_ESCROW = "withdraw_escrow";
export const SEED_WITHDRAW_RECEIPT = "withdraw_receipt";
