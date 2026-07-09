import { Connection, PublicKey } from "@solana/web3.js";

import { decodeGammaLpVaultData, GammaLpVaultRaw } from "~/vendor/gamma";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "~/vendor/spl";

/** Fetch and decode a Gamma `LpVault` account. Throws if it does not exist. */
export async function fetchGammaLpVault(
  connection: Connection,
  lpVault: PublicKey
): Promise<GammaLpVaultRaw> {
  const info = await connection.getAccountInfo(lpVault);
  if (!info) {
    throw new Error(`Gamma LpVault account not found: ${lpVault.toBase58()}`);
  }
  return decodeGammaLpVaultData(info.data, lpVault);
}

/**
 * Resolve the SPL token program the vault's mints live under by reading the
 * asset mint's owner. The Gamma program uses a single `token_program` account
 * for both the asset and share mints, so one lookup is sufficient.
 */
export async function resolveVaultTokenProgram(
  connection: Connection,
  assetsMint: PublicKey
): Promise<PublicKey> {
  const info = await connection.getAccountInfo(assetsMint);
  if (info && info.owner.equals(TOKEN_2022_PROGRAM_ID)) {
    return TOKEN_2022_PROGRAM_ID;
  }
  return TOKEN_PROGRAM_ID;
}
