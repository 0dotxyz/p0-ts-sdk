import type { ReadonlyUint8Array } from "@solana/kit";

import { decodeAccountData } from "../account-data";

import { getVaultDecoder, VAULT_DISCRIMINATOR, type Vault } from "~/generated/exponent-core";

export { EXPONENT_CLMM_PROGRAM_ADDRESS, SwapDirection } from "~/generated/exponent-clmm";
export { EXPONENT_CORE_PROGRAM_ADDRESS } from "~/generated/exponent-core";

/**
 * Decodes an Exponent core `Vault` account.
 * @throws if the discriminator doesn't match
 */
export function decodeExponentVault(data: ReadonlyUint8Array): Vault {
  return decodeAccountData(data, VAULT_DISCRIMINATOR, getVaultDecoder(), "Exponent Vault");
}
