import type { Instruction } from "@solana/kit";

import { MarginfiInstruction, parseMarginfiIx } from "~/instructions";

/**
 * Byte offset of the u64 `amount` argument within a deposit instruction's data.
 * Layout for every deposit variant is: 8-byte discriminator followed by an 8-byte
 * little-endian u64 amount (see the marginfi IDL).
 */
const DEPOSIT_AMOUNT_OFFSET = 8;

/** The deposit instructions we are allowed to patch. */
const DEPOSIT_INSTRUCTIONS = new Set([
  MarginfiInstruction.LendingAccountDeposit,
  MarginfiInstruction.KaminoDeposit,
  MarginfiInstruction.DriftDeposit,
  MarginfiInstruction.JuplendDeposit,
]);

/**
 * Returns true if the instruction is a marginfi deposit instruction (any integration).
 * Used to locate the amount-bearing deposit ix within a flashloan instruction array.
 */
export function isDepositIx(ix: Instruction): boolean {
  const parsed = parseMarginfiIx(ix);
  return parsed !== undefined && DEPOSIT_INSTRUCTIONS.has(parsed.instructionType);
}

/**
 * Returns a copy of an already-built deposit instruction with its `amount` replaced.
 *
 * The deferred-swap loop flow builds the deposit instruction with a market-price
 * estimate before the swap output is known, then patches the real swap output amount
 * once the swap engine has run. Because the amount is a fixed-offset little-endian u64,
 * this is a pure byte patch — no account/key changes.
 *
 * @param ix - The deposit instruction.
 * @param amountNative - The new amount in native (base) units.
 * @throws if `ix` is not a marginfi deposit instruction or the amount is negative
 */
export function patchDepositAmount(ix: Instruction, amountNative: bigint): Instruction {
  if (!isDepositIx(ix)) {
    throw new Error("patchDepositAmount: instruction is not a known deposit instruction");
  }

  if (amountNative < 0n) {
    throw new Error("patchDepositAmount: amount must be non-negative");
  }

  const data = Uint8Array.from(ix.data ?? []);
  new DataView(data.buffer).setBigUint64(DEPOSIT_AMOUNT_OFFSET, amountNative, true);
  return { ...ix, data };
}
