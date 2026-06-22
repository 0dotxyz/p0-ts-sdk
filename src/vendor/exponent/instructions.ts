import { AccountMeta, PublicKey, TransactionInstruction } from "@solana/web3.js";

import { TOKEN_PROGRAM_ID } from "~/vendor/spl";

import { EXPONENT_CORE_PROGRAM_ID } from "./constants";
import { ExponentMergeAccounts } from "./types";
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
  ];

  return new TransactionInstruction({
    keys,
    programId: EXPONENT_CORE_PROGRAM_ID,
    data,
  });
}

const exponentInstructions = {
  makeExponentMergeIx,
};

export default exponentInstructions;
