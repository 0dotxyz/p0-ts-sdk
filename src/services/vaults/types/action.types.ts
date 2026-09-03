import { AddressLookupTableAccount, Connection, PublicKey } from "@solana/web3.js";

import type { SwapOpts, SwapEngineRunner } from "~/services/account";
import { Amount } from "~/types";

// -- Gamma Vault Actions ----

/**
 * Base params shared by every Gamma vault action.
 * `lpVault` is the vault state account (`LpVault`); its on-chain fields supply
 * the asset/share mints, the vault asset token account, and the fee recipient.
 * `tokenProgram` is auto-detected from the asset mint owner when omitted.
 */
interface VaultActionBaseParams {
  user: PublicKey;
  lpVault: PublicKey;
  connection: Connection;
  tokenProgram?: PublicKey;
}

interface VaultTxExtras {
  luts?: AddressLookupTableAccount[];
  blockhash?: string;
}

/** `amount` is in raw base units of the vault's asset mint. */
export interface MakeVaultDepositIxParams extends VaultActionBaseParams {
  amount: Amount;
}
export interface MakeVaultDepositTxParams extends MakeVaultDepositIxParams, VaultTxExtras {}

/** `sharesAmount` is in raw base units of the vault's share mint. */
export interface MakeVaultWithdrawIxParams extends VaultActionBaseParams {
  sharesAmount: Amount;
}
export interface MakeVaultWithdrawTxParams extends MakeVaultWithdrawIxParams, VaultTxExtras {}

export interface MakeVaultCompleteWithdrawalIxParams extends VaultActionBaseParams {}
export interface MakeVaultCompleteWithdrawalTxParams
  extends MakeVaultCompleteWithdrawalIxParams, VaultTxExtras {}

/**
 * Zap-deposit: swap `inputMint` into the vault's asset mint, then deposit.
 * `inputAmount` is a UI amount of `inputMint`.
 */
export interface MakeVaultDepositWithSwapTxParams extends VaultActionBaseParams, VaultTxExtras {
  inputMint: string;
  inputAmount: Amount;
  inputDecimals: number;
  swapOpts: SwapOpts;
  swapEngineRunner?: SwapEngineRunner;
}
