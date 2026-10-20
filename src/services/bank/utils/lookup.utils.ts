import type { Address } from "@solana/kit";

import { BankType } from "../types";

/**
 * Lookup-or-throw helpers for action-builder inputs. The optional `makeError`
 * lets callers throw their own typed error (e.g. a TransactionBuildingError
 * with user-facing copy) instead of a plain Error.
 */

export function requireBank(
  bankMap: Map<string, BankType>,
  address: Address,
  makeError: (message: string) => Error = (message) => new Error(message)
): BankType {
  const bank = bankMap.get(address);
  if (!bank) {
    throw makeError(`bank ${address} not found`);
  }
  return bank;
}

export function requireTokenProgram(
  tokenProgramsByBank: Map<string, Address>,
  address: Address,
  makeError: (message: string) => Error = (message) => new Error(message)
): Address {
  const tokenProgram = tokenProgramsByBank.get(address);
  if (!tokenProgram) {
    throw makeError(`token program for bank ${address} not provided`);
  }
  return tokenProgram;
}
