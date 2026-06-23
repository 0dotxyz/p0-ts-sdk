import { AccountMeta, PublicKey, TransactionInstruction } from "@solana/web3.js";

import { TOKEN_PROGRAM_ID } from "~/vendor/spl";

import { EXPONENT_CORE_PROGRAM_ID } from "./constants";
import { ExponentMergeAccounts, ExponentStripAccounts, ExponentTradePtAccounts } from "./types";
import { deriveExponentEventAuthority } from "./utils/derive.utils";

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

const exponentInstructions = {
  makeExponentMergeIx,
  makeExponentTradePtIx,
  makeExponentStripIx,
  exponentBuyPtArgs,
};

export default exponentInstructions;
