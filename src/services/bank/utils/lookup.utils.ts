import { PublicKey } from "@solana/web3.js";

import { BankType } from "../types";

/**
 * Lookup-or-throw helpers for action-builder inputs. The optional `makeError`
 * lets callers throw their own typed error (e.g. a TransactionBuildingError
 * with user-facing copy) instead of a plain Error.
 */

export function requireBank(
  bankMap: Map<string, BankType>,
  address: PublicKey,
  makeError: (message: string) => Error = (message) => new Error(message)
): BankType {
  const bank = bankMap.get(address.toBase58());
  if (!bank) {
    throw makeError(`bank ${address.toBase58()} not found`);
  }
  return bank;
}

export function requireTokenProgram(
  tokenProgramsByBank: Map<string, PublicKey>,
  address: PublicKey,
  makeError: (message: string) => Error = (message) => new Error(message)
): PublicKey {
  const tokenProgram = tokenProgramsByBank.get(address.toBase58());
  if (!tokenProgram) {
    throw makeError(`token program for bank ${address.toBase58()} not provided`);
  }
  return tokenProgram;
}
