import { BigNumber } from "bignumber.js";
import { PublicKey } from "@solana/web3.js";

import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from "~/vendor/spl";

import {
  ExponentMergeAccounts,
  ExponentMergeContext,
  ExponentVault,
  ResolveExponentMergeContextParams,
} from "../types";

import {
  fetchExponentVault,
  fetchExponentVaultFromMarket,
  getMintDecimals,
} from "./deserialize.utils";

/**
 * Resolve everything `makeRollPtTx` needs for an Exponent PT roll by decoding the maturity
 * `Vault` (every vault-side `merge` account is a `has_one` field on it) and deriving the
 * owner's PT/YT/SY token accounts.
 */
export async function resolveExponentMergeContext(
  params: ResolveExponentMergeContextParams
): Promise<ExponentMergeContext> {
  const { connection, owner } = params;
  const ptYtTokenProgram = params.ptYtTokenProgram ?? TOKEN_PROGRAM_ID;
  const syTokenProgram = params.syTokenProgram ?? TOKEN_PROGRAM_ID;

  let vaultAddress: PublicKey;
  let vault: ExponentVault;
  if (params.vault) {
    vaultAddress = params.vault;
    vault = await fetchExponentVault(connection, vaultAddress);
  } else if (params.market) {
    const res = await fetchExponentVaultFromMarket(connection, params.market);
    vaultAddress = res.vault;
    vault = res.account;
  } else {
    throw new Error("resolveExponentMergeContext: one of `vault` or `market` is required");
  }

  const ptSrcAta = getAssociatedTokenAddressSync(vault.mintPt, owner, true, ptYtTokenProgram);
  const ytSrcAta = getAssociatedTokenAddressSync(vault.mintYt, owner, true, ptYtTokenProgram);
  const sySrcDstAta = getAssociatedTokenAddressSync(vault.mintSy, owner, true, syTokenProgram);

  const mergeAccounts: ExponentMergeAccounts = {
    owner,
    authority: vault.authority,
    vault: vaultAddress,
    sySrcDstAta,
    escrowSy: vault.escrowSy,
    ytSrcAta,
    ptSrcAta,
    mintYt: vault.mintYt,
    mintPt: vault.mintPt,
    syProgram: vault.syProgram,
    addressLookupTable: vault.addressLookupTable,
    yieldPosition: vault.yieldPosition,
    tokenProgram: ptYtTokenProgram,
  };

  const decimals = await getMintDecimals(connection, vault.mintSy);

  return {
    vaultAddress,
    vault,
    mergeAccounts,
    underlying: { mint: vault.mintSy, decimals, tokenProgram: syTokenProgram },
    computeRedeemedAmountNative(ptAmountNative: bigint): bigint {
      // Mirrors Exponent's `merge`: amount_sy_out = floor(amount_py × pt_redemption_rate),
      // where pt_redemption_rate = sy_for_pt / pt_supply (Vault::pt_redemption_rate).
      if (vault.ptSupply === 0n) return 0n;
      const sy = new BigNumber(ptAmountNative.toString())
        .times(vault.syForPt.toString())
        .div(vault.ptSupply.toString())
        .integerValue(BigNumber.ROUND_FLOOR);
      return BigInt(sy.toFixed(0));
    },
  };
}
