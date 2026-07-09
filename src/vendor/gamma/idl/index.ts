import { GammaVault } from "./gamma-vault";
import GAMMA_VAULT_IDL_JSON from "./gamma-vault.json";

export const GAMMA_VAULT_IDL = GAMMA_VAULT_IDL_JSON as unknown as GammaVault;
export type GammaVaultIdlType = GammaVault;
