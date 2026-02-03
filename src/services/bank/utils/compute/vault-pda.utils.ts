import { PublicKey } from "@solana/web3.js";

import {
  PDA_BANK_LIQUIDITY_VAULT_SEED,
  PDA_BANK_INSURANCE_VAULT_SEED,
  PDA_BANK_FEE_VAULT_SEED,
  PDA_BANK_LIQUIDITY_VAULT_AUTH_SEED,
  PDA_BANK_INSURANCE_VAULT_AUTH_SEED,
  PDA_BANK_FEE_VAULT_AUTH_SEED,
} from "~/utils";

import { BankVaultType } from "../../types";

/**
 * Vault PDA Utilities
 * ===================
 */

/**
 * Gets the PDA seed for a specific bank vault type.
 *
 * @param type - The vault type (Liquidity, Insurance, or Fee)
 * @returns The PDA seed buffer for the vault
 * @throws Error if vault type is unknown
 */
export function getBankVaultSeeds(type: BankVaultType): Buffer {
  switch (type) {
    case BankVaultType.LiquidityVault:
      return PDA_BANK_LIQUIDITY_VAULT_SEED;
    case BankVaultType.InsuranceVault:
      return PDA_BANK_INSURANCE_VAULT_SEED;
    case BankVaultType.FeeVault:
      return PDA_BANK_FEE_VAULT_SEED;
    default:
      throw Error(`Unknown vault type ${type}`);
  }
}

/**
 * Gets the PDA seed for a vault authority.
 *
 * @param type - The vault type (Liquidity, Insurance, or Fee)
 * @returns The PDA seed buffer for the vault authority
 * @throws Error if vault type is unknown
 * @internal
 */
function getBankVaultAuthoritySeeds(type: BankVaultType): Buffer {
  switch (type) {
    case BankVaultType.LiquidityVault:
      return PDA_BANK_LIQUIDITY_VAULT_AUTH_SEED;
    case BankVaultType.InsuranceVault:
      return PDA_BANK_INSURANCE_VAULT_AUTH_SEED;
    case BankVaultType.FeeVault:
      return PDA_BANK_FEE_VAULT_AUTH_SEED;
    default:
      throw Error(`Unknown vault type ${type}`);
  }
}

/**
 * Computes the Program Derived Address (PDA) for a bank vault authority.
 *
 * The vault authority is the account that has signing authority over vault operations.
 * This is a PDA derived from the vault type seed and bank public key.
 *
 * @param bankVaultType - The type of vault (Liquidity, Insurance, or Fee)
 * @param bankPk - The bank's public key
 * @param programId - The marginfi program ID
 * @returns Tuple of [PDA PublicKey, bump seed]
 *
 * @example
 * ```typescript
 * const [vaultAuthority, bump] = getBankVaultAuthority(
 *   BankVaultType.LiquidityVault,
 *   bankAddress,
 *   MARGINFI_PROGRAM_ID
 * );
 * ```
 */
export function getBankVaultAuthority(
  bankVaultType: BankVaultType,
  bankPk: PublicKey,
  programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [getBankVaultAuthoritySeeds(bankVaultType), bankPk.toBuffer()],
    programId
  );
}
