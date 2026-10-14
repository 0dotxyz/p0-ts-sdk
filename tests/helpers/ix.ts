import type { Instruction } from "@solana/kit";

import type { ParsedMarginfiInstruction } from "~/generated/marginfi";
import { MarginfiInstruction, parseMarginfiIx } from "~/instructions";
import type { SolanaTransaction } from "~/services/transaction";

type MarginfiIx<T extends MarginfiInstruction> = Extract<
  ParsedMarginfiInstruction<string>,
  { instructionType: T }
>;

// The decoded marginfi instructions of `type` in `transactions`
export function findMarginfiIxs<T extends MarginfiInstruction>(
  type: T,
  ...transactions: SolanaTransaction[]
): MarginfiIx<T>[] {
  return transactions
    .flatMap((tx) => tx.message.instructions)
    .map(parseMarginfiIx)
    .filter((ix): ix is MarginfiIx<T> => ix?.instructionType === type);
}

export const isMarginfiIx = (type: MarginfiInstruction) => (ix: Instruction) =>
  parseMarginfiIx(ix)?.instructionType === type;
