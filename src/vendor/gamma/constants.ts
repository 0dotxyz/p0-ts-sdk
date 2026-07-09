import { PublicKey } from "@solana/web3.js";

/** Gamma Protocol vault program — LP vaults with instant deposits, escrow withdrawals. */
export const GAMMA_VAULT_PROGRAM_ID = new PublicKey(
  "GaMmanX9i4jGmqDZZD2tbD6B2v9p21btenPneMXnTczV"
);

// LP vault PDA seeds
export const SEED_WITHDRAWAL_POLICY = "withdrawal_policy";
export const SEED_DEPOSIT_RECEIPT = "deposit_receipt";
export const SEED_WITHDRAW_ESCROW = "withdraw_escrow";
export const SEED_WITHDRAW_RECEIPT = "withdraw_receipt";
