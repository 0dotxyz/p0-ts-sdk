import { PublicKey } from "@solana/web3.js";

export const PDA_BANK_LIQUIDITY_VAULT_AUTH_SEED = Buffer.from("liquidity_vault_auth");
export const PDA_BANK_INSURANCE_VAULT_AUTH_SEED = Buffer.from("insurance_vault_auth");
export const PDA_BANK_FEE_VAULT_AUTH_SEED = Buffer.from("fee_vault_auth");

export const PDA_BANK_LIQUIDITY_VAULT_SEED = Buffer.from("liquidity_vault");
export const PDA_BANK_INSURANCE_VAULT_SEED = Buffer.from("insurance_vault");
export const PDA_BANK_FEE_VAULT_SEED = Buffer.from("fee_vault");
export const PDA_BANK_FEE_STATE_SEED = Buffer.from("feestate");
export const PDA_BANK_EMISSIONS_AUTH_SEED = Buffer.from("emissions_auth_seed");
export const PDA_BANK_EMISSIONS_VAULT_SEED = Buffer.from("emissions_vault");

export const PDA_MARGINFI_ACCOUNT_SEED = Buffer.from("marginfi_account");

/**
 * Derives the liquidity vault authority PDA for a bank
 * Seeds: ["liquidity_vault_auth", bank]
 */
export function deriveBankLiquidityVaultAuthority(
  programId: PublicKey,
  bank: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [PDA_BANK_LIQUIDITY_VAULT_AUTH_SEED, bank.toBuffer()],
    programId
  );
}

/**
 * Derives the liquidity vault PDA for a bank
 * Seeds: ["liquidity_vault", bank]
 */
export function deriveBankLiquidityVault(
  programId: PublicKey,
  bank: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [PDA_BANK_LIQUIDITY_VAULT_SEED, bank.toBuffer()],
    programId
  );
}

/**
 * Derives the insurance vault authority PDA for a bank
 * Seeds: ["insurance_vault_auth", bank]
 */
export function deriveBankInsuranceVaultAuthority(
  programId: PublicKey,
  bank: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [PDA_BANK_INSURANCE_VAULT_AUTH_SEED, bank.toBuffer()],
    programId
  );
}

/**
 * Derives the insurance vault PDA for a bank
 * Seeds: ["insurance_vault", bank]
 */
export function deriveBankInsuranceVault(
  programId: PublicKey,
  bank: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [PDA_BANK_INSURANCE_VAULT_SEED, bank.toBuffer()],
    programId
  );
}

/**
 * Derives the fee vault authority PDA for a bank
 * Seeds: ["fee_vault_auth", bank]
 */
export function deriveBankFeeVaultAuthority(
  programId: PublicKey,
  bank: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [PDA_BANK_FEE_VAULT_AUTH_SEED, bank.toBuffer()],
    programId
  );
}

/**
 * Derives the fee vault PDA for a bank
 * Seeds: ["fee_vault", bank]
 */
export function deriveBankFeeVault(programId: PublicKey, bank: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([PDA_BANK_FEE_VAULT_SEED, bank.toBuffer()], programId);
}

/**
 * Derives the fee state PDA
 * Seeds: ["feestate"]
 */
export function deriveFeeState(programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([PDA_BANK_FEE_STATE_SEED], programId);
}

/**
 * Derives the emissions auth PDA for a bank
 * Seeds: ["emissions_auth_seed", bank]
 */
export function deriveBankEmissionsAuth(
  programId: PublicKey,
  bank: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [PDA_BANK_EMISSIONS_AUTH_SEED, bank.toBuffer()],
    programId
  );
}

/**
 * Derives the emissions vault PDA for a bank and emissions mint
 * Seeds: ["emissions_vault", bank, emissionsMint]
 */
export function deriveBankEmissionsVault(
  programId: PublicKey,
  bank: PublicKey,
  emissionsMint: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [PDA_BANK_EMISSIONS_VAULT_SEED, bank.toBuffer(), emissionsMint.toBuffer()],
    programId
  );
}

/**
 * Derives the marginfi account PDA
 * Seeds: ["marginfi_account", group, authority, accountIndex, thirdPartyId]
 */
export function deriveMarginfiAccount(
  programId: PublicKey,
  group: PublicKey,
  authority: PublicKey,
  accountIndex: number,
  thirdPartyId: number = 0
): [PublicKey, number] {
  const accountIndexBuf = Buffer.alloc(2);
  accountIndexBuf.writeUInt16LE(accountIndex);

  const thirdPartyIdBuf = Buffer.alloc(2);
  thirdPartyIdBuf.writeUInt16LE(thirdPartyId);

  return PublicKey.findProgramAddressSync(
    [
      PDA_MARGINFI_ACCOUNT_SEED,
      group.toBuffer(),
      authority.toBuffer(),
      accountIndexBuf,
      thirdPartyIdBuf,
    ],
    programId
  );
}
