import { GammaVault } from "./gamma-idl";
import GAMMA_VAULT_IDL_JSON from "./gamma-idl.json";

export const GAMMA_VAULT_IDL = GAMMA_VAULT_IDL_JSON as unknown as GammaVault;
export type GammaVaultIdlType = GammaVault;
