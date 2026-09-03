import { AccountMeta, PublicKey } from "@solana/web3.js";
import { BigNumber } from "bignumber.js";

import { makeSplStakePoolUpdateBalanceIx } from "../instructions";
import {
  ExponentClmmTradePtAccounts,
  ExponentClmmTradePtContext,
  ExponentCpiInterfaceContext,
  ExponentMergeAccounts,
  ExponentMergeContext,
  ExponentStripAccounts,
  ExponentStripContext,
  ExponentTradePtAccounts,
  ExponentTradePtContext,
  ExponentVault,
  ExponentWrapperMergeAccounts,
  ExponentWrapperMergeContext,
  ResolveExponentClmmTradePtContextParams,
  ResolveExponentMergeContextParams,
  ResolveExponentStripContextParams,
  ResolveExponentTradePtContextParams,
  ResolveExponentWrapperMergeContextParams,
} from "../types";

import {
  fetchExponentMarketThree,
  fetchExponentMarketTwo,
  fetchExponentVault,
  fetchExponentVaultFromMarket,
  getMintDecimals,
} from "./deserialize.utils";

import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from "~/vendor/spl";

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

/** Dedupe AccountMetas by pubkey, keeping first order and OR-ing writability (matches the SDK). */
function uniqueRemainingAccounts(metas: AccountMeta[]): AccountMeta[] {
  const seen = new Map<string, AccountMeta>();
  for (const m of metas) {
    const key = m.pubkey.toBase58();
    const prev = seen.get(key);
    if (prev) prev.isWritable = prev.isWritable || m.isWritable;
    else seen.set(key, { ...m });
  }
  return [...seen.values()];
}

/** SPL Stake Pool account layout offsets for the fields the refresh ix needs. */
const STAKE_POOL_OFFSETS = {
  validatorList: 98,
  reserveStake: 130,
  poolMint: 162,
  managerFeeAccount: 194,
} as const;

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
 * Resolve everything the roll needs to buy the successor PT natively on its **CLMM**
 * (`MarketThree`) pool — SY → PT in one on-chain trade, no base unwrap and no external
 * aggregator. The newer maturities (e.g. October bulkSOL) only list a CLMM PT/SY pool (no
 * `MarketTwo`, no order book), so this is the direct buy leg.
 *
 * Decodes the pool, resolves its SY-program CPI accounts from the pool's address lookup
 * table (each `CpiInterfaceContext` is an ALT index), de-duplicates them, and derives the
 * owner's SY/PT token accounts. The returned {@link ExponentClmmTradePtContext.addressLookupTable}
 * must be added to the transaction's lookup tables. The pool uses a single `ticks` account,
 * so the resolved account set is fixed regardless of trade size.
 */
export async function resolveExponentClmmTradePtContext(
  params: ResolveExponentClmmTradePtContextParams
): Promise<ExponentClmmTradePtContext> {
  const { connection, owner } = params;
  const ptTokenProgram = params.ptTokenProgram ?? TOKEN_PROGRAM_ID;
  const syTokenProgram = params.syTokenProgram ?? TOKEN_PROGRAM_ID;

  const market = await fetchExponentMarketThree(connection, params.market);

  const altResult = await connection.getAddressLookupTable(market.addressLookupTable);
  const alt = altResult.value;
  if (!alt) {
    throw new Error(
      `Exponent CLMM market address lookup table not found: ${market.addressLookupTable.toBase58()}`
    );
  }
  const altAddresses = alt.state.addresses;
  const altKey = market.addressLookupTable;

  // Order mirrors the SDK's CLMM trade_pt remaining accounts:
  // getSyState ++ getPositionState ++ depositSy ++ withdrawSy, then de-duplicated.
  const remainingAccounts = uniqueRemainingAccounts([
    ...resolveCpiMetas(market.cpiAccounts.getSyState, altAddresses, altKey),
    ...resolveCpiMetas(market.cpiAccounts.getPositionState, altAddresses, altKey),
    ...resolveCpiMetas(market.cpiAccounts.depositSy, altAddresses, altKey),
    ...resolveCpiMetas(market.cpiAccounts.withdrawSy, altAddresses, altKey),
  ]);

  const tokenSyTrader = getAssociatedTokenAddressSync(market.mintSy, owner, true, syTokenProgram);
  const tokenPtTrader = getAssociatedTokenAddressSync(market.mintPt, owner, true, ptTokenProgram);

  const tradePtAccounts: ExponentClmmTradePtAccounts = {
    trader: owner,
    market: market.selfAddress,
    ticks: market.ticks,
    tokenSyTrader,
    tokenPtTrader,
    tokenSyEscrow: market.tokenSyEscrow,
    tokenPtEscrow: market.tokenPtEscrow,
    addressLookupTable: market.addressLookupTable,
    syProgram: market.syProgram,
    tokenFeeTreasurySy: market.tokenFeeTreasurySy,
    tokenFeeTreasuryPt: market.tokenFeeTreasuryPt,
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

/**
 * Build the SPL Stake Pool `UpdateStakePoolBalance` instruction for `stakePool` by reading
 * the pool's account (validator list / reserve / manager fee / pool mint are at fixed offsets)
 * and deriving the pool's withdraw authority PDA — all dep-free. The pool's owning program is
 * read from the account itself (no hard-coded stake-pool program id).
 */
async function resolveSplStakePoolRefreshIx(
  connection: ResolveExponentWrapperMergeContextParams["connection"],
  stakePool: PublicKey
) {
  const info = await connection.getAccountInfo(stakePool);
  if (!info) throw new Error(`SPL stake pool account not found: ${stakePool.toBase58()}`);
  const stakePoolProgram = info.owner;
  const at = (off: number) => new PublicKey(info.data.subarray(off, off + 32));
  const [withdrawAuthority] = PublicKey.findProgramAddressSync(
    [stakePool.toBuffer(), Buffer.from("withdraw")],
    stakePoolProgram
  );
  return makeSplStakePoolUpdateBalanceIx({
    stakePoolProgram,
    stakePool,
    withdrawAuthority,
    validatorList: at(STAKE_POOL_OFFSETS.validatorList),
    reserveStake: at(STAKE_POOL_OFFSETS.reserveStake),
    managerFeeAccount: at(STAKE_POOL_OFFSETS.managerFeeAccount),
    poolMint: at(STAKE_POOL_OFFSETS.poolMint),
  });
}

/**
 * Resolve everything the roll's redeem leg needs to turn matured PT into the underlying
 * **base** token via `wrapper_merge` (merge PT → SY, then CPI-redeem SY → base, in one ix) —
 * so the buy leg swaps a normal token, not the un-swappable SY.
 *
 * Decodes the maturity `Vault`, derives the owner's SY/PT/YT/base token accounts, assembles
 * the flavor redeem accounts (all derivable: the generic SY state is `get_sy_state[0]`, the
 * SPL stake pool is `get_sy_state[3]`, the base escrow is `ATA(syState, baseMint)`), appends
 * the vault's `withdraw_sy ++ get_sy_state` CPI accounts, and builds the stake-pool refresh
 * that must run first. Validated byte-for-byte against the Exponent SDK's `ixMergeToBase`.
 */
export async function resolveExponentWrapperMergeContext(
  params: ResolveExponentWrapperMergeContextParams
): Promise<ExponentWrapperMergeContext> {
  const { connection, owner, baseMint } = params;
  const ptYtTokenProgram = params.ptYtTokenProgram ?? TOKEN_PROGRAM_ID;
  const syTokenProgram = params.syTokenProgram ?? TOKEN_PROGRAM_ID;
  const baseTokenProgram = params.baseTokenProgram ?? TOKEN_PROGRAM_ID;

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
    throw new Error("resolveExponentWrapperMergeContext: one of `vault` or `market` is required");
  }

  const altResult = await connection.getAddressLookupTable(vault.addressLookupTable);
  const alt = altResult.value;
  if (!alt) {
    throw new Error(
      `Exponent vault address lookup table not found: ${vault.addressLookupTable.toBase58()}`
    );
  }
  const altKey = vault.addressLookupTable;
  const getSyState = resolveCpiMetas(vault.cpiAccounts.getSyState, alt.state.addresses, altKey);
  const withdrawSy = resolveCpiMetas(vault.cpiAccounts.withdrawSy, alt.state.addresses, altKey);
  if (getSyState.length < 4) {
    throw new Error(
      "resolveExponentWrapperMergeContext: unexpected get_sy_state shape (expected the generic " +
        "SPL-stake-pool flavor: [syState, mintSy, tokenSyEscrow, stakePool])"
    );
  }
  // The generic SY state owns the base escrow; the SPL stake pool drives the SY↔base rate.
  const syState = getSyState[0].pubkey;
  const stakePool = getSyState[3].pubkey;

  const syAta = getAssociatedTokenAddressSync(vault.mintSy, owner, true, syTokenProgram);
  const ptAta = getAssociatedTokenAddressSync(vault.mintPt, owner, true, ptYtTokenProgram);
  const ytAta = getAssociatedTokenAddressSync(vault.mintYt, owner, true, ptYtTokenProgram);
  const baseAta = getAssociatedTokenAddressSync(baseMint, owner, true, baseTokenProgram);
  const baseEscrow = getAssociatedTokenAddressSync(baseMint, syState, true, baseTokenProgram);

  // Flavor `redeem_sy` accounts (generic SY program). Owner (the redeemer) keeps its signer
  // flag; everything else is non-signer. Order taken from the SDK's `flavor.ixRedeemSy`.
  const redeem: AccountMeta[] = [
    { pubkey: owner, isSigner: true, isWritable: true },
    { pubkey: syState, isSigner: false, isWritable: true },
    { pubkey: baseAta, isSigner: false, isWritable: true },
    { pubkey: baseEscrow, isSigner: false, isWritable: true },
    { pubkey: syAta, isSigner: false, isWritable: true },
    { pubkey: vault.mintSy, isSigner: false, isWritable: true },
    { pubkey: baseMint, isSigner: false, isWritable: false },
    { pubkey: syTokenProgram, isSigner: false, isWritable: false },
    { pubkey: baseTokenProgram, isSigner: false, isWritable: false },
    { pubkey: stakePool, isSigner: false, isWritable: true },
  ];
  const cpi = uniqueRemainingAccounts([...withdrawSy, ...getSyState]);

  const wrapperMergeAccounts: ExponentWrapperMergeAccounts = {
    owner,
    syAta,
    vault: vaultAddress,
    escrowSy: vault.escrowSy,
    ytAta,
    ptAta,
    mintYt: vault.mintYt,
    mintPt: vault.mintPt,
    authority: vault.authority,
    addressLookupTable: vault.addressLookupTable,
    yieldPosition: vault.yieldPosition,
    syProgram: vault.syProgram,
    tokenProgram: ptYtTokenProgram,
    remainingAccounts: [...redeem, ...cpi],
    redeemSyAccountsUntil: redeem.length,
  };

  const [baseDecimals, stakePoolRefreshIx] = await Promise.all([
    getMintDecimals(connection, baseMint),
    resolveSplStakePoolRefreshIx(connection, stakePool),
  ]);

  return {
    vaultAddress,
    vault,
    wrapperMergeAccounts,
    preInstructions: [stakePoolRefreshIx],
    addressLookupTable: alt,
    baseToken: { mint: baseMint, decimals: baseDecimals, tokenProgram: baseTokenProgram },
    setupMints: [
      { mint: baseMint, tokenProgram: baseTokenProgram },
      { mint: vault.mintSy, tokenProgram: syTokenProgram },
      { mint: vault.mintPt, tokenProgram: ptYtTokenProgram },
      { mint: vault.mintYt, tokenProgram: ptYtTokenProgram },
    ],
    computeRedeemedBaseNative(ptAmountNative: bigint): bigint {
      // `merge` gives sy = floor(pt × sy_for_pt / pt_supply); the SY→base unwrap is 1:1 in
      // *amount* (the SY exchange rate is a valuation, not a conversion factor — verified on
      // mainnet: it slightly *under*-estimates the real base, a safe never-short lower bound
      // for the swap input). So base ≈ the merge SY output.
      if (vault.ptSupply === 0n) return 0n;
      const base = new BigNumber(ptAmountNative.toString())
        .times(vault.syForPt.toString())
        .div(vault.ptSupply.toString())
        .integerValue(BigNumber.ROUND_FLOOR);
      return BigInt(base.toFixed(0));
    },
  };
}
