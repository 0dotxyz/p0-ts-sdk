import {
  AccountRole,
  assertAccountExists,
  fetchAddressesForLookupTables,
  fetchEncodedAccount,
  type AccountMeta,
  type Address,
  type GetAccountInfoApi,
  type GetMultipleAccountsApi,
  type Rpc,
} from "@solana/kit";
import { findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";

import { fetchMarketThree } from "~/generated/exponent-clmm";
import type { TradePtInput } from "~/generated/exponent-clmm";
import {
  fetchMarketTwo,
  fetchVault,
  type CpiInterfaceContext,
  type MergeInput,
} from "~/generated/exponent-core";

type ExponentRpc = Rpc<GetAccountInfoApi & GetMultipleAccountsApi>;

async function fetchLookupTable(rpc: ExponentRpc, lookupTable: Address): Promise<Address[]> {
  const addresses = (await fetchAddressesForLookupTables([lookupTable], rpc))[lookupTable];
  if (!addresses) {
    throw new Error(`Exponent address lookup table not found: ${lookupTable}`);
  }
  return addresses;
}

// Classic and Token-2022 mints share the decimals offset.
async function fetchMintDecimals(rpc: ExponentRpc, mint: Address): Promise<number> {
  const account = await fetchEncodedAccount(rpc, mint);
  assertAccountExists(account);
  return account.data[44];
}

/**
 * Resolves ALT-indexed CPI contexts to account metas. `is_signer` marks accounts the inner SY CPI
 * signs via PDA seeds, never a transaction signer, so it is dropped.
 */
function resolveCpiMetas(
  contexts: CpiInterfaceContext[],
  lookupTable: Address[],
  lookupTableAddress: Address
): AccountMeta[] {
  return contexts.map(({ altIndex, isWritable }) => {
    const address = lookupTable[altIndex];
    if (!address) {
      throw new Error(
        `Exponent CPI account alt_index ${altIndex} out of range ` +
          `(ALT ${lookupTableAddress} has ${lookupTable.length} entries)`
      );
    }
    return { address, role: isWritable ? AccountRole.WRITABLE : AccountRole.READONLY };
  });
}

/**
 * Resolves the accounts of a PT merge (redeem) on the maturity vault: the vault is read directly or
 * from its `MarketTwo`, the owner's PT/YT/SY token accounts are derived, and the SY CPI accounts are
 * resolved from the vault's lookup table.
 * @throws if the vault, market, lookup table or SY mint account doesn't exist, or a CPI index is out of range
 */
export async function resolveExponentMergeContext({
  rpc,
  owner,
  vault: vaultAddress,
  market,
  ptYtTokenProgram = TOKEN_PROGRAM_ADDRESS,
  syTokenProgram = TOKEN_PROGRAM_ADDRESS,
}: {
  rpc: ExponentRpc;
  owner: Address;
  ptYtTokenProgram?: Address;
  syTokenProgram?: Address;
} & ({ vault: Address; market?: undefined } | { vault?: undefined; market: Address })) {
  const resolvedVaultAddress = vaultAddress ?? (await fetchMarketTwo(rpc, market)).data.vault;
  const { data: vault } = await fetchVault(rpc, resolvedVaultAddress);

  const [lookupTable, [ptSrc], [ytSrc], [syDst], decimals] = await Promise.all([
    fetchLookupTable(rpc, vault.addressLookupTable),
    findAssociatedTokenPda({ owner, tokenProgram: ptYtTokenProgram, mint: vault.mintPt }),
    findAssociatedTokenPda({ owner, tokenProgram: ptYtTokenProgram, mint: vault.mintYt }),
    findAssociatedTokenPda({ owner, tokenProgram: syTokenProgram, mint: vault.mintSy }),
    fetchMintDecimals(rpc, vault.mintSy),
  ]);

  const mergeInput: Omit<MergeInput, "owner" | "eventAuthority" | "program" | "amount"> = {
    authority: vault.authority,
    vault: resolvedVaultAddress,
    syDst,
    escrowSy: vault.escrowSy,
    ytSrc,
    ptSrc,
    mintYt: vault.mintYt,
    mintPt: vault.mintPt,
    tokenProgram: ptYtTokenProgram,
    syProgram: vault.syProgram,
    addressLookupTable: vault.addressLookupTable,
    yieldPosition: vault.yieldPosition,
  };

  return {
    vaultAddress: resolvedVaultAddress,
    vault,
    mergeInput,
    remainingAccounts: [
      ...resolveCpiMetas(vault.cpiAccounts.getSyState, lookupTable, vault.addressLookupTable),
      ...resolveCpiMetas(vault.cpiAccounts.withdrawSy, lookupTable, vault.addressLookupTable),
    ],
    lookupTable: { address: vault.addressLookupTable, addresses: lookupTable },
    underlying: { mint: vault.mintSy, decimals, tokenProgram: syTokenProgram },
    // Vault::pt_redemption_rate: floor(pt × sy_for_pt / pt_supply)
    computeRedeemedAmountNative: (ptAmountNative: bigint) =>
      vault.ptSupply === 0n ? 0n : (ptAmountNative * vault.syForPt) / vault.ptSupply,
  };
}

/**
 * Resolves the accounts of a CLMM `trade_pt` on a `MarketThree` pool: the owner's SY/PT token
 * accounts are derived and the pool's SY CPI accounts are resolved from its lookup table and
 * deduplicated (writability OR-ed).
 * @throws if the pool, lookup table or a mint account doesn't exist, or a CPI index is out of range
 */
export async function resolveExponentClmmTradePtContext({
  rpc,
  owner,
  market,
  ptTokenProgram = TOKEN_PROGRAM_ADDRESS,
  syTokenProgram = TOKEN_PROGRAM_ADDRESS,
}: {
  rpc: ExponentRpc;
  owner: Address;
  market: Address;
  ptTokenProgram?: Address;
  syTokenProgram?: Address;
}) {
  const { data: pool } = await fetchMarketThree(rpc, market);
  const [lookupTable, [tokenSyTrader], [tokenPtTrader], syDecimals, ptDecimals] = await Promise.all(
    [
      fetchLookupTable(rpc, pool.addressLookupTable),
      findAssociatedTokenPda({ owner, tokenProgram: syTokenProgram, mint: pool.mintSy }),
      findAssociatedTokenPda({ owner, tokenProgram: ptTokenProgram, mint: pool.mintPt }),
      fetchMintDecimals(rpc, pool.mintSy),
      fetchMintDecimals(rpc, pool.mintPt),
    ]
  );

  const { getSyState, getPositionState, depositSy, withdrawSy } = pool.cpiSyAccounts;
  const uniqueAccounts = new Map<Address, AccountMeta>();
  for (const meta of resolveCpiMetas(
    [...getSyState, ...getPositionState, ...depositSy, ...withdrawSy],
    lookupTable,
    pool.addressLookupTable
  )) {
    const seen = uniqueAccounts.get(meta.address);
    if (!seen || meta.role === AccountRole.WRITABLE) {
      uniqueAccounts.set(meta.address, seen ? { ...seen, role: AccountRole.WRITABLE } : meta);
    }
  }

  const tradePtInput: Omit<
    TradePtInput,
    | "trader"
    | "eventAuthority"
    | "program"
    | "amountIn"
    | "swapDirection"
    | "amountOutConstraint"
    | "priceSpotLimit"
  > = {
    market: pool.selfAddress,
    ticks: pool.ticks,
    tokenSyTrader,
    tokenPtTrader,
    tokenSyEscrow: pool.tokenSyEscrow,
    tokenPtEscrow: pool.tokenPtEscrow,
    addressLookupTable: pool.addressLookupTable,
    tokenProgram: ptTokenProgram,
    syProgram: pool.syProgram,
    tokenFeeTreasurySy: pool.tokenFeeTreasurySy,
    tokenFeeTreasuryPt: pool.tokenFeeTreasuryPt,
  };

  return {
    marketAddress: pool.selfAddress,
    pool,
    tradePtInput,
    remainingAccounts: [...uniqueAccounts.values()],
    lookupTable: { address: pool.addressLookupTable, addresses: lookupTable },
    sy: { mint: pool.mintSy, decimals: syDecimals, tokenProgram: syTokenProgram },
    pt: { mint: pool.mintPt, decimals: ptDecimals, tokenProgram: ptTokenProgram },
  };
}
