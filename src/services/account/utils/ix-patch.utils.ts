import { TransactionInstruction } from "@solana/web3.js";
import BN from "bn.js";

/**
 * Byte offset of the u64 `amount` argument within a deposit instruction's data buffer.
 * Layout for every deposit variant is: 8-byte discriminator followed by an 8-byte
 * little-endian u64 amount (see `sync-instructions.ts` / the marginfi IDL).
 */
const DEPOSIT_AMOUNT_OFFSET = 8;

/**
 * Discriminators (first 8 bytes) of the deposit instructions we are allowed to patch.
 * Used as a safety guard so we never rewrite the wrong instruction's bytes.
 */
const DEPOSIT_DISCRIMINATORS: ReadonlyArray<readonly number[]> = [
  [171, 94, 235, 103, 82, 64, 212, 140], // lending_account_deposit
  [237, 8, 188, 187, 115, 99, 49, 85], // kamino_deposit
  [252, 63, 250, 201, 98, 55, 130, 12], // drift_deposit
  [114, 11, 218, 81, 183, 165, 143, 255], // juplend_deposit
];

function isKnownDepositIx(data: Buffer): boolean {
  return DEPOSIT_DISCRIMINATORS.some((disc) =>
    disc.every((byte, i) => data[i] === byte)
  );
}

/**
 * Returns true if the instruction is a marginfi deposit instruction (any integration).
 * Used to locate the amount-bearing deposit ix within a flashloan instruction array.
 */
export function isDepositIx(ix: TransactionInstruction): boolean {
  return ix.data.length >= 8 && isKnownDepositIx(ix.data);
}

/**
 * Rewrites the `amount` field of an already-built deposit instruction in place.
 *
 * The deferred-swap loop flow builds the deposit instruction with a market-price
 * estimate before the swap output is known, then patches the real swap output amount
 * once the swap engine has run. Because the amount is a fixed-offset little-endian u64,
 * this is a pure byte patch — no account/key changes — so it is safe to apply to an
 * instruction that is about to be (re)compiled into a flashloan transaction.
 *
 * @param ix - The deposit instruction to mutate.
 * @param amountNative - The new amount in native (base) units.
 */
export function patchDepositAmount(ix: TransactionInstruction, amountNative: BN): void {
  if (ix.data.length < DEPOSIT_AMOUNT_OFFSET + 8) {
    throw new Error(
      `patchDepositAmount: instruction data too short (${ix.data.length} bytes), expected at least ${
        DEPOSIT_AMOUNT_OFFSET + 8
      }`
    );
  }

  if (!isKnownDepositIx(ix.data)) {
    throw new Error(
      "patchDepositAmount: instruction discriminator does not match a known deposit instruction"
    );
  }

  if (amountNative.isNeg()) {
    throw new Error("patchDepositAmount: amount must be non-negative");
  }

  amountNative.toArrayLike(Buffer, "le", 8).copy(ix.data, DEPOSIT_AMOUNT_OFFSET);
}
