import {
  getAddressEncoder,
  getProgramDerivedAddress,
  getU16Encoder,
  type Address,
  type ProgramDerivedAddress,
} from "@solana/kit";

export const PDA_BANK_LIQUIDITY_VAULT_AUTH_SEED = "liquidity_vault_auth";
export const PDA_BANK_INSURANCE_VAULT_AUTH_SEED = "insurance_vault_auth";
export const PDA_BANK_FEE_VAULT_AUTH_SEED = "fee_vault_auth";

export const PDA_BANK_LIQUIDITY_VAULT_SEED = "liquidity_vault";
export const PDA_BANK_INSURANCE_VAULT_SEED = "insurance_vault";
export const PDA_BANK_FEE_VAULT_SEED = "fee_vault";
export const PDA_BANK_FEE_STATE_SEED = "feestate";
export const PDA_BANK_EMISSIONS_AUTH_SEED = "emissions_auth_seed";
export const PDA_BANK_EMISSIONS_VAULT_SEED = "emissions_vault";

export const PDA_MARGINFI_ACCOUNT_SEED = "marginfi_account";

/**
 * Derives the liquidity vault authority PDA for a bank
 * Seeds: ["liquidity_vault_auth", bank]
 */
export function deriveBankLiquidityVaultAuthority(
  programId: Address,
  bank: Address
): Promise<ProgramDerivedAddress> {
  return getProgramDerivedAddress({
    programAddress: programId,
    seeds: [PDA_BANK_LIQUIDITY_VAULT_AUTH_SEED, getAddressEncoder().encode(bank)],
  });
}

/**
 * Derives the liquidity vault PDA for a bank
 * Seeds: ["liquidity_vault", bank]
 */
export function deriveBankLiquidityVault(
  programId: Address,
  bank: Address
): Promise<ProgramDerivedAddress> {
  return getProgramDerivedAddress({
    programAddress: programId,
    seeds: [PDA_BANK_LIQUIDITY_VAULT_SEED, getAddressEncoder().encode(bank)],
  });
}

/**
 * Derives the insurance vault authority PDA for a bank
 * Seeds: ["insurance_vault_auth", bank]
 */
export function deriveBankInsuranceVaultAuthority(
  programId: Address,
  bank: Address
): Promise<ProgramDerivedAddress> {
  return getProgramDerivedAddress({
    programAddress: programId,
    seeds: [PDA_BANK_INSURANCE_VAULT_AUTH_SEED, getAddressEncoder().encode(bank)],
  });
}

/**
 * Derives the insurance vault PDA for a bank
 * Seeds: ["insurance_vault", bank]
 */
export function deriveBankInsuranceVault(
  programId: Address,
  bank: Address
): Promise<ProgramDerivedAddress> {
  return getProgramDerivedAddress({
    programAddress: programId,
    seeds: [PDA_BANK_INSURANCE_VAULT_SEED, getAddressEncoder().encode(bank)],
  });
}

/**
 * Derives the fee vault authority PDA for a bank
 * Seeds: ["fee_vault_auth", bank]
 */
export function deriveBankFeeVaultAuthority(
  programId: Address,
  bank: Address
): Promise<ProgramDerivedAddress> {
  return getProgramDerivedAddress({
    programAddress: programId,
    seeds: [PDA_BANK_FEE_VAULT_AUTH_SEED, getAddressEncoder().encode(bank)],
  });
}

/**
 * Derives the fee vault PDA for a bank
 * Seeds: ["fee_vault", bank]
 */
export function deriveBankFeeVault(
  programId: Address,
  bank: Address
): Promise<ProgramDerivedAddress> {
  return getProgramDerivedAddress({
    programAddress: programId,
    seeds: [PDA_BANK_FEE_VAULT_SEED, getAddressEncoder().encode(bank)],
  });
}

/**
 * Derives the fee state PDA
 * Seeds: ["feestate"]
 */
export function deriveFeeState(programId: Address): Promise<ProgramDerivedAddress> {
  return getProgramDerivedAddress({ programAddress: programId, seeds: [PDA_BANK_FEE_STATE_SEED] });
}

/**
 * Derives the emissions auth PDA for a bank
 * Seeds: ["emissions_auth_seed", bank]
 */
export function deriveBankEmissionsAuth(
  programId: Address,
  bank: Address
): Promise<ProgramDerivedAddress> {
  return getProgramDerivedAddress({
    programAddress: programId,
    seeds: [PDA_BANK_EMISSIONS_AUTH_SEED, getAddressEncoder().encode(bank)],
  });
}

/**
 * Derives the emissions vault PDA for a bank and emissions mint
 * Seeds: ["emissions_vault", bank, emissionsMint]
 */
export function deriveBankEmissionsVault(
  programId: Address,
  bank: Address,
  emissionsMint: Address
): Promise<ProgramDerivedAddress> {
  return getProgramDerivedAddress({
    programAddress: programId,
    seeds: [
      PDA_BANK_EMISSIONS_VAULT_SEED,
      getAddressEncoder().encode(bank),
      getAddressEncoder().encode(emissionsMint),
    ],
  });
}

/**
 * Derives the marginfi account PDA
 * Seeds: ["marginfi_account", group, authority, accountIndex, thirdPartyId]
 */
export function deriveMarginfiAccount(
  programId: Address,
  group: Address,
  authority: Address,
  accountIndex: number,
  thirdPartyId: number = 0
): Promise<ProgramDerivedAddress> {
  return getProgramDerivedAddress({
    programAddress: programId,
    seeds: [
      PDA_MARGINFI_ACCOUNT_SEED,
      getAddressEncoder().encode(group),
      getAddressEncoder().encode(authority),
      getU16Encoder().encode(accountIndex),
      getU16Encoder().encode(thirdPartyId),
    ],
  });
}
