import { BigNumber } from "bignumber.js";
import { AccountMeta, PublicKey } from "@solana/web3.js";

import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from "~/vendor/spl";

import {
  ExponentCpiInterfaceContext,
  ExponentMergeAccounts,
  ExponentMergeContext,
  ExponentStripAccounts,
  ExponentStripContext,
  ExponentTradePtAccounts,
  ExponentTradePtContext,
  ExponentVault,
  ResolveExponentMergeContextParams,
  ResolveExponentStripContextParams,
  ResolveExponentTradePtContextParams,
} from "../types";

import {
  fetchExponentMarketTwo,
  fetchExponentVault,
  fetchExponentVaultFromMarket,
  getMintDecimals,
} from "./deserialize.utils";

/**
 * Resolve a list of `CpiInterfaceContext`s (ALT-indexed) into concrete {@link AccountMeta}s
 * against the given lookup-table addresses, validating each index is in range.
 */
function resolveCpiMetas(
  contexts: ExponentCpiInterfaceContext[],
  altAddresses: PublicKey[],
  altKey: PublicKey
): AccountMeta[] {
  return contexts.map((ctx) => {
    const pubkey = altAddresses[ctx.altIndex];
    if (!pubkey) {
      throw new Error(
        `Exponent CPI account alt_index ${ctx.altIndex} out of range ` +
          `(ALT ${altKey.toBase58()} has ${altAddresses.length} entries)`
      );
    }
    // A CPI context's `is_signer` marks an account the *inner* SY-program CPI signs (via
    // PDA seeds, `invoke_signed`) — never a transaction-level signer. Forcing `false` here
    // avoids a phantom required signature (the only real signer, the owner, is already a
    // fixed account; Solana de-dups and OR-merges privileges). Matches the SDK.
    return { pubkey, isSigner: false, isWritable: ctx.isWritable };
  });
}

/**
 * Resolve everything `makeRollPtTx` needs for an Exponent PT roll by decoding the maturity
 * `Vault` (every vault-side `merge` account is a `has_one` field on it), deriving the
 * owner's PT/YT/SY token accounts, and resolving the SY-program CPI remaining accounts
 * (`get_sy_state ++ withdraw_sy`) from the vault's address lookup table.
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

  // `merge`'s SY-CPI remaining accounts are referenced by index into the vault's ALT, and
  // the transaction must carry that ALT for them to fit / resolve.
  const altResult = await connection.getAddressLookupTable(vault.addressLookupTable);
  const alt = altResult.value;
  if (!alt) {
    throw new Error(
      `Exponent vault address lookup table not found: ${vault.addressLookupTable.toBase58()}`
    );
  }
  // Order mirrors the SDK's merge remaining accounts: getSyState ++ withdrawSy.
  const remainingAccounts: AccountMeta[] = [
    ...resolveCpiMetas(vault.cpiAccounts.getSyState, alt.state.addresses, vault.addressLookupTable),
    ...resolveCpiMetas(vault.cpiAccounts.withdrawSy, alt.state.addresses, vault.addressLookupTable),
  ];

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
    remainingAccounts,
  };

  const decimals = await getMintDecimals(connection, vault.mintSy);

  return {
    vaultAddress,
    vault,
    mergeAccounts,
    addressLookupTable: alt,
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

/**
 * Resolve everything `makeRollPtTx` needs to buy the successor PT natively (SY → PT,
 * no unwrap, no external aggregator) by trading on the successor maturity's `MarketTwo`.
 *
 * Decodes the market, resolves the SY-program CPI accounts from the market's address
 * lookup table (every `CpiInterfaceContext` is an ALT index), and derives the owner's
 * SY/PT token accounts. The returned {@link ExponentTradePtContext.addressLookupTable}
 * must be added to the transaction's lookup tables.
 */
export async function resolveExponentTradePtContext(
  params: ResolveExponentTradePtContextParams
): Promise<ExponentTradePtContext> {
  const { connection, owner } = params;
  const ptTokenProgram = params.ptTokenProgram ?? TOKEN_PROGRAM_ID;
  const syTokenProgram = params.syTokenProgram ?? TOKEN_PROGRAM_ID;

  const market = await fetchExponentMarketTwo(connection, params.market);

  // `trade_pt`'s SY-CPI accounts are referenced by index into the market's ALT, and the
  // transaction must carry that ALT for the program to resolve them.
  const altResult = await connection.getAddressLookupTable(market.addressLookupTable);
  const alt = altResult.value;
  if (!alt) {
    throw new Error(
      `Exponent market address lookup table not found: ${market.addressLookupTable.toBase58()}`
    );
  }
  const altAddresses = alt.state.addresses;
  const altKey = market.addressLookupTable;

  // Order mirrors the SDK's trade_pt remaining accounts: getSyState ++ depositSy ++ withdrawSy.
  const remainingAccounts: AccountMeta[] = [
    ...resolveCpiMetas(market.cpiAccounts.getSyState, altAddresses, altKey),
    ...resolveCpiMetas(market.cpiAccounts.depositSy, altAddresses, altKey),
    ...resolveCpiMetas(market.cpiAccounts.withdrawSy, altAddresses, altKey),
  ];

  const tokenSyTrader = getAssociatedTokenAddressSync(market.mintSy, owner, true, syTokenProgram);
  const tokenPtTrader = getAssociatedTokenAddressSync(market.mintPt, owner, true, ptTokenProgram);

  const tradePtAccounts: ExponentTradePtAccounts = {
    trader: owner,
    market: market.selfAddress,
    tokenSyTrader,
    tokenPtTrader,
    tokenSyEscrow: market.tokenSyEscrow,
    tokenPtEscrow: market.tokenPtEscrow,
    addressLookupTable: market.addressLookupTable,
    syProgram: market.syProgram,
    tokenFeeTreasurySy: market.tokenFeeTreasurySy,
    tokenProgram: ptTokenProgram,
    remainingAccounts,
  };

  const [syDecimals, ptDecimals] = await Promise.all([
    getMintDecimals(connection, market.mintSy),
    getMintDecimals(connection, market.mintPt),
  ]);

  return {
    marketAddress: market.selfAddress,
    market,
    tradePtAccounts,
    addressLookupTable: alt,
    sy: { mint: market.mintSy, decimals: syDecimals, tokenProgram: syTokenProgram },
    pt: { mint: market.mintPt, decimals: ptDecimals, tokenProgram: ptTokenProgram },
  };
}

/**
 * Resolve everything needed to `strip` SY → PT + YT on an Exponent vault (the buy leg that
 * *mints* the successor PT, unbounded by AMM depth). Decodes the vault, derives the owner's
 * SY/PT/YT token accounts, resolves the `deposit_sy` CPI remaining accounts from the vault's
 * address lookup table, and exposes the last-seen SY exchange rate for sizing the minted PT.
 */
export async function resolveExponentStripContext(
  params: ResolveExponentStripContextParams
): Promise<ExponentStripContext> {
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
    throw new Error("resolveExponentStripContext: one of `vault` or `market` is required");
  }

  const altResult = await connection.getAddressLookupTable(vault.addressLookupTable);
  const alt = altResult.value;
  if (!alt) {
    throw new Error(
      `Exponent vault address lookup table not found: ${vault.addressLookupTable.toBase58()}`
    );
  }
  // strip's SY-CPI remaining accounts are just `deposit_sy` (it deposits SY into the vault).
  const remainingAccounts: AccountMeta[] = resolveCpiMetas(
    vault.cpiAccounts.depositSy,
    alt.state.addresses,
    vault.addressLookupTable
  );

  const sySrc = getAssociatedTokenAddressSync(vault.mintSy, owner, true, syTokenProgram);
  const ptDst = getAssociatedTokenAddressSync(vault.mintPt, owner, true, ptYtTokenProgram);
  const ytDst = getAssociatedTokenAddressSync(vault.mintYt, owner, true, ptYtTokenProgram);

  const stripAccounts: ExponentStripAccounts = {
    depositor: owner,
    authority: vault.authority,
    vault: vaultAddress,
    sySrc,
    escrowSy: vault.escrowSy,
    ytDst,
    ptDst,
    mintYt: vault.mintYt,
    mintPt: vault.mintPt,
    syProgram: vault.syProgram,
    addressLookupTable: vault.addressLookupTable,
    yieldPosition: vault.yieldPosition,
    tokenProgram: ptYtTokenProgram,
    remainingAccounts,
  };

  const [syDecimals, ptDecimals] = await Promise.all([
    getMintDecimals(connection, vault.mintSy),
    getMintDecimals(connection, vault.mintPt),
  ]);
  const syExchangeRate = vault.lastSeenSyExchangeRate.toNumber();

  return {
    vaultAddress,
    vault,
    stripAccounts,
    addressLookupTable: alt,
    sy: { mint: vault.mintSy, decimals: syDecimals, tokenProgram: syTokenProgram },
    pt: { mint: vault.mintPt, decimals: ptDecimals, tokenProgram: ptYtTokenProgram },
    yt: { mint: vault.mintYt, tokenProgram: ptYtTokenProgram },
    syExchangeRate,
    computeStrippedPtNative(syInNative: bigint): bigint {
      // strip mints py = floor(amount_sy × sy_exchange_rate) PT (and the same YT).
      const pt = vault.lastSeenSyExchangeRate
        .times(syInNative.toString())
        .integerValue(BigNumber.ROUND_FLOOR);
      return BigInt(pt.toFixed(0));
    },
  };
}
