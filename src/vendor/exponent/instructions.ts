import { Buffer } from "buffer";

import { AccountMeta, PublicKey, TransactionInstruction, SystemProgram } from "@solana/web3.js";

import { EXPONENT_CLMM_PROGRAM_ID, EXPONENT_CORE_PROGRAM_ID } from "./constants";
import {
  ExponentClmmTradePtAccounts,
  ExponentMergeAccounts,
  ExponentStripAccounts,
  ExponentSwapDirection,
  ExponentTradePtAccounts,
  ExponentWrapperMergeAccounts,
} from "./types";
import {
  deriveExponentClmmEventAuthority,
  deriveExponentEventAuthority,
} from "./utils/derive.utils";

import { TOKEN_PROGRAM_ID } from "~/vendor/spl";

/**
 * `merge` instruction discriminator, taken from the committed Exponent IDL
 * (`merge` → `[5]` — a single-byte custom discriminator, not the default 8-byte Anchor
 * one). Account order + writable/signer flags below also mirror the IDL / the program's
 * `#[derive(Accounts)] struct Merge` exactly.
 */
const MERGE_DISCRIMINATOR = Buffer.from([5]);

/**
 * Build the Exponent `merge(amount)` instruction — redeems `amount` PT (post-maturity,
 * 1:1, no AMM/slippage) into SY at `sySrcDstAta`.
 *
 * @param accounts resolved merge accounts (see {@link ExponentMergeAccounts})
 * @param amountNative PT amount to redeem, in native units (u64)
 */
export function makeExponentMergeIx(
  accounts: ExponentMergeAccounts,
  amountNative: bigint
): TransactionInstruction {
  const tokenProgram = accounts.tokenProgram ?? TOKEN_PROGRAM_ID;
  const eventAuthority = deriveExponentEventAuthority();

  // data = discriminator(1) + amount(u64 LE, 8)
  const data = Buffer.alloc(MERGE_DISCRIMINATOR.length + 8);
  MERGE_DISCRIMINATOR.copy(data, 0);
  data.writeBigUInt64LE(amountNative, MERGE_DISCRIMINATOR.length);

  // Order + writable/signer flags taken verbatim from the IDL's `merge` accounts.
  const keys: AccountMeta[] = [
    { pubkey: accounts.owner, isSigner: true, isWritable: true },
    { pubkey: accounts.authority, isSigner: false, isWritable: true },
    { pubkey: accounts.vault, isSigner: false, isWritable: true },
    { pubkey: accounts.sySrcDstAta, isSigner: false, isWritable: true },
    { pubkey: accounts.escrowSy, isSigner: false, isWritable: true },
    { pubkey: accounts.ytSrcAta, isSigner: false, isWritable: true },
    { pubkey: accounts.ptSrcAta, isSigner: false, isWritable: true },
    { pubkey: accounts.mintYt, isSigner: false, isWritable: true },
    { pubkey: accounts.mintPt, isSigner: false, isWritable: true },
    { pubkey: tokenProgram, isSigner: false, isWritable: false },
    { pubkey: accounts.syProgram, isSigner: false, isWritable: false },
    { pubkey: accounts.addressLookupTable, isSigner: false, isWritable: false },
    { pubkey: accounts.yieldPosition, isSigner: false, isWritable: true },
    { pubkey: eventAuthority, isSigner: false, isWritable: false },
    { pubkey: EXPONENT_CORE_PROGRAM_ID, isSigner: false, isWritable: false },
    // SY-program CPI accounts (getSyState ++ withdrawSy), ALT-resolved (post-maturity merge
    // still CPIs into the SY program to move SY out of escrow).
    ...(accounts.remainingAccounts ?? []),
  ];

  return new TransactionInstruction({
    keys,
    programId: EXPONENT_CORE_PROGRAM_ID,
    data,
  });
}

/**
 * `trade_pt` instruction discriminator, taken from the committed Exponent IDL
 * (`trade_pt` → `[17]` — a single-byte custom discriminator). Account order +
 * writable/signer flags below mirror the IDL / the program's `#[derive(Accounts)]`
 * exactly, and match the SDK's `createTradePtInstruction`.
 */
const TRADE_PT_DISCRIMINATOR = Buffer.from([17]);

/**
 * Signed `trade_pt` args for **buying** PT with SY (the roll's buy leg).
 *
 * The program's convention is signed-from-the-trader's-perspective: a buy makes PT flow
 * *to* the trader (`net_trader_pt > 0`) and SY flow *away* (`sy_constraint < 0`, the most
 * negative SY balance change the trader will tolerate — i.e. the max SY spent).
 *
 * @param ptOutNative   exact PT the trader receives (native u64). Set to a conservative
 *                      floor; the trade gives exactly this many PT.
 * @param maxSyInNative max SY the trader is willing to spend (native u64).
 */
export function exponentBuyPtArgs({
  ptOutNative,
  maxSyInNative,
}: {
  ptOutNative: bigint;
  maxSyInNative: bigint;
}): { netTraderPt: bigint; syConstraint: bigint } {
  return { netTraderPt: ptOutNative, syConstraint: -maxSyInNative };
}

/**
 * Build the Exponent `trade_pt(net_trader_pt, sy_constraint)` instruction — an
 * implied-APY AMM trade of SY ↔ PT on a `MarketTwo`. For a buy use {@link exponentBuyPtArgs}.
 *
 * Pricing PT reads the SY exchange rate on-chain, so `accounts.remainingAccounts` (the
 * flavor's SY-program CPI accounts, resolved from the market ALT) are appended after the
 * 12 fixed accounts, and the transaction must carry the market's address lookup table.
 *
 * @param accounts resolved trade accounts (see {@link ExponentTradePtAccounts})
 * @param args     signed `net_trader_pt` / `sy_constraint` (i64 LE)
 */
export function makeExponentTradePtIx(
  accounts: ExponentTradePtAccounts,
  args: { netTraderPt: bigint; syConstraint: bigint }
): TransactionInstruction {
  const tokenProgram = accounts.tokenProgram ?? TOKEN_PROGRAM_ID;
  const eventAuthority = deriveExponentEventAuthority();

  // data = discriminator(1) + net_trader_pt(i64 LE, 8) + sy_constraint(i64 LE, 8)
  const data = Buffer.alloc(TRADE_PT_DISCRIMINATOR.length + 16);
  TRADE_PT_DISCRIMINATOR.copy(data, 0);
  data.writeBigInt64LE(args.netTraderPt, TRADE_PT_DISCRIMINATOR.length);
  data.writeBigInt64LE(args.syConstraint, TRADE_PT_DISCRIMINATOR.length + 8);

  // Order + writable/signer flags taken verbatim from the IDL's `trade_pt` accounts.
  const keys: AccountMeta[] = [
    { pubkey: accounts.trader, isSigner: true, isWritable: true },
    { pubkey: accounts.market, isSigner: false, isWritable: true },
    { pubkey: accounts.tokenSyTrader, isSigner: false, isWritable: true },
    { pubkey: accounts.tokenPtTrader, isSigner: false, isWritable: true },
    { pubkey: accounts.tokenSyEscrow, isSigner: false, isWritable: true },
    { pubkey: accounts.tokenPtEscrow, isSigner: false, isWritable: true },
    { pubkey: accounts.addressLookupTable, isSigner: false, isWritable: false },
    { pubkey: tokenProgram, isSigner: false, isWritable: false },
    { pubkey: accounts.syProgram, isSigner: false, isWritable: false },
    { pubkey: accounts.tokenFeeTreasurySy, isSigner: false, isWritable: true },
    { pubkey: eventAuthority, isSigner: false, isWritable: false },
    { pubkey: EXPONENT_CORE_PROGRAM_ID, isSigner: false, isWritable: false },
    // SY-program CPI accounts (getSyState ++ depositSy ++ withdrawSy), ALT-resolved.
    ...accounts.remainingAccounts,
  ];

  return new TransactionInstruction({
    keys,
    programId: EXPONENT_CORE_PROGRAM_ID,
    data,
  });
}

/**
 * `strip` instruction discriminator (Exponent IDL `strip` → `[4]`, single-byte). Account
 * order/flags mirror the IDL / SDK `createStripInstruction`. `strip` is the inverse of
 * `merge`: it takes SY and mints PT + YT (1:1 against the vault — no AMM, no slippage).
 */
const STRIP_DISCRIMINATOR = Buffer.from([4]);

/**
 * Build the Exponent `strip(amount)` instruction — splits `amount` SY into PT + YT on an
 * active vault. The minted PT lands in `ptDst`, the YT in `ytDst`. Because PT is minted (not
 * swapped), this is the buy leg for rolling more PT than a thin AMM pool could provide.
 *
 * Pricing PT/YT reads the SY rate on-chain, so `accounts.remainingAccounts` (the flavor's
 * `deposit_sy` CPI accounts, resolved from the vault ALT) are appended after the 15 fixed
 * accounts, and the transaction must carry the vault's address lookup table.
 *
 * @param accounts resolved strip accounts (see {@link ExponentStripAccounts})
 * @param amountNative SY amount to strip, in native units (u64)
 */
export function makeExponentStripIx(
  accounts: ExponentStripAccounts,
  amountNative: bigint
): TransactionInstruction {
  const tokenProgram = accounts.tokenProgram ?? TOKEN_PROGRAM_ID;
  const eventAuthority = deriveExponentEventAuthority();

  // data = discriminator(1) + amount(u64 LE, 8)
  const data = Buffer.alloc(STRIP_DISCRIMINATOR.length + 8);
  STRIP_DISCRIMINATOR.copy(data, 0);
  data.writeBigUInt64LE(amountNative, STRIP_DISCRIMINATOR.length);

  // Order + writable/signer flags taken verbatim from the IDL / SDK `createStripInstruction`.
  const keys: AccountMeta[] = [
    { pubkey: accounts.depositor, isSigner: true, isWritable: true },
    { pubkey: accounts.authority, isSigner: false, isWritable: true },
    { pubkey: accounts.vault, isSigner: false, isWritable: true },
    { pubkey: accounts.sySrc, isSigner: false, isWritable: true },
    { pubkey: accounts.escrowSy, isSigner: false, isWritable: true },
    { pubkey: accounts.ytDst, isSigner: false, isWritable: true },
    { pubkey: accounts.ptDst, isSigner: false, isWritable: true },
    { pubkey: accounts.mintYt, isSigner: false, isWritable: true },
    { pubkey: accounts.mintPt, isSigner: false, isWritable: true },
    { pubkey: tokenProgram, isSigner: false, isWritable: false },
    { pubkey: accounts.addressLookupTable, isSigner: false, isWritable: false },
    { pubkey: accounts.syProgram, isSigner: false, isWritable: false },
    { pubkey: accounts.yieldPosition, isSigner: false, isWritable: true },
    { pubkey: eventAuthority, isSigner: false, isWritable: false },
    { pubkey: EXPONENT_CORE_PROGRAM_ID, isSigner: false, isWritable: false },
    // SY-program CPI accounts (depositSy), ALT-resolved.
    ...(accounts.remainingAccounts ?? []),
  ];

  return new TransactionInstruction({ keys, programId: EXPONENT_CORE_PROGRAM_ID, data });
}

/**
 * `wrapper_merge` instruction discriminator (Exponent IDL `wrapper_merge` → `[39]`,
 * single-byte). It merges PT (post-maturity, 1:1) **and** CPIs into the flavor's SY program
 * to redeem the resulting SY into the underlying **base** token — so the roll's buy leg can
 * swap a normal token instead of the un-swappable SY. Account order/flags mirror the IDL /
 * SDK `createWrapperMergeInstruction`.
 */
const WRAPPER_MERGE_DISCRIMINATOR = Buffer.from([39]);

/**
 * Build the Exponent `wrapper_merge(amount_py, redeem_sy_accounts_until)` instruction —
 * redeems `amountPyNative` PT into the underlying base token at the owner's base ATA.
 *
 * The remaining accounts are `[...flavor redeem accounts, ...vault SY-CPI accounts]`;
 * `redeemSyAccountsUntil` tells the program where the redeem accounts end. The redeem's first
 * account is the owner and keeps its signer flag (the SY-CPI accounts are forced non-signer,
 * resolved upstream). The transaction must carry the vault's address lookup table.
 *
 * @param accounts resolved wrapper-merge accounts (see {@link ExponentWrapperMergeAccounts})
 * @param args     `amountPyNative` (u64) PT to redeem + `redeemSyAccountsUntil` (u8)
 */
export function makeExponentWrapperMergeIx(
  accounts: ExponentWrapperMergeAccounts,
  args: { amountPyNative: bigint; redeemSyAccountsUntil: number }
): TransactionInstruction {
  const tokenProgram = accounts.tokenProgram ?? TOKEN_PROGRAM_ID;
  const eventAuthority = deriveExponentEventAuthority();

  // data = discriminator(1) + amount_py(u64 LE, 8) + redeem_sy_accounts_until(u8, 1)
  const data = Buffer.alloc(WRAPPER_MERGE_DISCRIMINATOR.length + 9);
  WRAPPER_MERGE_DISCRIMINATOR.copy(data, 0);
  data.writeBigUInt64LE(args.amountPyNative, WRAPPER_MERGE_DISCRIMINATOR.length);
  data.writeUInt8(args.redeemSyAccountsUntil, WRAPPER_MERGE_DISCRIMINATOR.length + 8);

  // Order + writable/signer flags taken verbatim from the IDL's `wrapper_merge` accounts.
  const keys: AccountMeta[] = [
    { pubkey: accounts.owner, isSigner: true, isWritable: true },
    { pubkey: accounts.syAta, isSigner: false, isWritable: true },
    { pubkey: accounts.vault, isSigner: false, isWritable: true },
    { pubkey: accounts.escrowSy, isSigner: false, isWritable: true },
    { pubkey: accounts.ytAta, isSigner: false, isWritable: true },
    { pubkey: accounts.ptAta, isSigner: false, isWritable: true },
    { pubkey: accounts.mintYt, isSigner: false, isWritable: true },
    { pubkey: accounts.mintPt, isSigner: false, isWritable: true },
    { pubkey: accounts.authority, isSigner: false, isWritable: true },
    { pubkey: accounts.addressLookupTable, isSigner: false, isWritable: false },
    { pubkey: tokenProgram, isSigner: false, isWritable: false },
    { pubkey: accounts.yieldPosition, isSigner: false, isWritable: true },
    { pubkey: accounts.syProgram, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: eventAuthority, isSigner: false, isWritable: false },
    { pubkey: EXPONENT_CORE_PROGRAM_ID, isSigner: false, isWritable: false },
    // [...redeem (flavor SY-redeem accounts), ...cpi (withdraw_sy ++ get_sy_state)]
    ...accounts.remainingAccounts,
  ];

  return new TransactionInstruction({ keys, programId: EXPONENT_CORE_PROGRAM_ID, data });
}

/** SPL Stake Pool `UpdateStakePoolBalance` instruction tag (variant index 7). */
const SPL_STAKE_POOL_UPDATE_BALANCE_TAG = Buffer.from([7]);

/**
 * Build the SPL Stake Pool `UpdateStakePoolBalance` instruction — refreshes a stake pool's
 * total-lamports / pool-token-supply so the pool↔token exchange rate is current for the
 * epoch. An SPL-stake-pool SY flavor (e.g. bulkSOL) requires this immediately before
 * `wrapper_merge`, otherwise the redeem reads a stale SY↔base rate.
 *
 * Account order matches the SPL Stake Pool program's `UpdateStakePoolBalance`.
 */
export function makeSplStakePoolUpdateBalanceIx(accounts: {
  stakePoolProgram: PublicKey;
  stakePool: PublicKey;
  withdrawAuthority: PublicKey;
  validatorList: PublicKey;
  reserveStake: PublicKey;
  managerFeeAccount: PublicKey;
  poolMint: PublicKey;
  tokenProgram?: PublicKey;
}): TransactionInstruction {
  const tokenProgram = accounts.tokenProgram ?? TOKEN_PROGRAM_ID;
  const keys: AccountMeta[] = [
    { pubkey: accounts.stakePool, isSigner: false, isWritable: true },
    { pubkey: accounts.withdrawAuthority, isSigner: false, isWritable: false },
    { pubkey: accounts.validatorList, isSigner: false, isWritable: true },
    { pubkey: accounts.reserveStake, isSigner: false, isWritable: false },
    { pubkey: accounts.managerFeeAccount, isSigner: false, isWritable: true },
    { pubkey: accounts.poolMint, isSigner: false, isWritable: true },
    { pubkey: tokenProgram, isSigner: false, isWritable: false },
  ];
  return new TransactionInstruction({
    keys,
    programId: accounts.stakePoolProgram,
    data: Buffer.from(SPL_STAKE_POOL_UPDATE_BALANCE_TAG),
  });
}

/**
 * CLMM (`MarketThree`) `trade_pt` discriminator (`@exponent-labs/exponent-clmm-idl`,
 * `trade_pt` → `[3]`, single-byte). Account order/flags + the arg layout below mirror the
 * SDK's `createTradePtInstruction` exactly. This is the buy leg the matured-PT roll uses to
 * buy the successor PT directly on the PT/SY CLMM (`SwapDirection.SyToPt`) — no base
 * round-trip, no aggregator, and (unlike Raydium CLMMs) a single `ticks` account, so the
 * account set is fixed regardless of trade size.
 */
const CLMM_TRADE_PT_DISCRIMINATOR = Buffer.from([3]);

/** Encode a borsh `Option<u64>` (1-byte tag + u64 LE when `Some`). */
function encodeOptionU64(value: bigint | null): Buffer {
  if (value === null) return Buffer.from([0]);
  const buf = Buffer.alloc(9);
  buf.writeUInt8(1, 0);
  buf.writeBigUInt64LE(value, 1);
  return buf;
}

/**
 * Signed `trade_pt` args for **buying** PT with SY on the CLMM (the roll's buy leg).
 *
 * `amountIn` is the exact SY spent; `swapDirection` is `SyToPt`; `amountOutConstraint` is
 * the minimum PT out (slippage floor); `priceSpotLimit` (ln-implied-APY limit) is left unset.
 *
 * @param amountInSyNative SY to spend (native u64).
 * @param minPtOutNative   minimum PT to receive (native u64) — the swap reverts below this.
 */
export function exponentClmmBuyPtArgs({
  amountInSyNative,
  minPtOutNative,
}: {
  amountInSyNative: bigint;
  minPtOutNative: bigint;
}): {
  amountIn: bigint;
  swapDirection: ExponentSwapDirection;
  amountOutConstraint: bigint | null;
  priceSpotLimit: null;
} {
  return {
    amountIn: amountInSyNative,
    swapDirection: ExponentSwapDirection.SyToPt,
    amountOutConstraint: minPtOutNative,
    priceSpotLimit: null,
  };
}

/**
 * Build the CLMM `trade_pt(amount_in, swap_direction, amount_out_constraint, price_spot_limit)`
 * instruction — an implied-APY AMM trade of SY ↔ PT on a `MarketThree` pool. For a buy use
 * {@link exponentClmmBuyPtArgs}.
 *
 * Pricing PT reads the SY exchange rate on-chain, so `accounts.remainingAccounts` (the SY-CPI
 * accounts resolved from the market ALT) are appended after the 14 fixed accounts, and the
 * transaction must carry the market's address lookup table.
 *
 * @param accounts resolved trade accounts (see {@link ExponentClmmTradePtAccounts})
 * @param args     `amountIn` (u64) + `swapDirection` (u8) + `amountOutConstraint` (Option<u64>)
 *                 + `priceSpotLimit` (Option<f64>, always `null` here)
 */
export function makeExponentClmmTradePtIx(
  accounts: ExponentClmmTradePtAccounts,
  args: {
    amountIn: bigint;
    swapDirection: ExponentSwapDirection;
    amountOutConstraint: bigint | null;
    priceSpotLimit: null;
  }
): TransactionInstruction {
  const tokenProgram = accounts.tokenProgram ?? TOKEN_PROGRAM_ID;
  const eventAuthority = deriveExponentClmmEventAuthority();

  // data = disc(1) + amount_in(u64 LE, 8) + swap_direction(u8, 1)
  //        + amount_out_constraint(Option<u64>) + price_spot_limit(Option<f64>)
  const head = Buffer.alloc(CLMM_TRADE_PT_DISCRIMINATOR.length + 9);
  CLMM_TRADE_PT_DISCRIMINATOR.copy(head, 0);
  head.writeBigUInt64LE(args.amountIn, CLMM_TRADE_PT_DISCRIMINATOR.length);
  head.writeUInt8(args.swapDirection, CLMM_TRADE_PT_DISCRIMINATOR.length + 8);
  // `priceSpotLimit` is always `null` here → a single 0 tag byte (no f64 follows).
  const data = Buffer.concat([head, encodeOptionU64(args.amountOutConstraint), Buffer.from([0])]);

  // Order + writable/signer flags taken verbatim from the IDL / SDK `createTradePtInstruction`.
  const keys: AccountMeta[] = [
    { pubkey: accounts.trader, isSigner: true, isWritable: true },
    { pubkey: accounts.market, isSigner: false, isWritable: true },
    { pubkey: accounts.ticks, isSigner: false, isWritable: true },
    { pubkey: accounts.tokenSyTrader, isSigner: false, isWritable: true },
    { pubkey: accounts.tokenPtTrader, isSigner: false, isWritable: true },
    { pubkey: accounts.tokenSyEscrow, isSigner: false, isWritable: true },
    { pubkey: accounts.tokenPtEscrow, isSigner: false, isWritable: true },
    { pubkey: accounts.addressLookupTable, isSigner: false, isWritable: false },
    { pubkey: tokenProgram, isSigner: false, isWritable: false },
    { pubkey: accounts.syProgram, isSigner: false, isWritable: false },
    { pubkey: accounts.tokenFeeTreasurySy, isSigner: false, isWritable: true },
    { pubkey: accounts.tokenFeeTreasuryPt, isSigner: false, isWritable: true },
    { pubkey: eventAuthority, isSigner: false, isWritable: false },
    { pubkey: EXPONENT_CLMM_PROGRAM_ID, isSigner: false, isWritable: false },
    // SY-program CPI accounts (getSyState ++ getPositionState ++ depositSy ++ withdrawSy), ALT-resolved.
    ...accounts.remainingAccounts,
  ];

  return new TransactionInstruction({ keys, programId: EXPONENT_CLMM_PROGRAM_ID, data });
}

const exponentInstructions = {
  makeExponentMergeIx,
  makeExponentTradePtIx,
  makeExponentStripIx,
  makeExponentWrapperMergeIx,
  makeExponentClmmTradePtIx,
  makeSplStakePoolUpdateBalanceIx,
  exponentBuyPtArgs,
  exponentClmmBuyPtArgs,
};

export default exponentInstructions;
