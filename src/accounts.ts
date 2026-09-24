import type { ReadonlyUint8Array } from "@solana/kit";

import {
  BANK_DISCRIMINATOR,
  FEE_STATE_DISCRIMINATOR,
  getBankDecoder,
  getFeeStateDecoder,
  getMarginfiAccountDecoder,
  getMarginfiGroupDecoder,
  MARGINFI_ACCOUNT_DISCRIMINATOR,
  MARGINFI_GROUP_DISCRIMINATOR,
  type Bank,
  type FeeState,
  type MarginfiAccount,
  type MarginfiGroup,
} from "./generated/marginfi";
import { decodeAccountData } from "./vendor/account-data";

export {
  BANK_DISCRIMINATOR,
  BankOperationalState as OperationalStateRaw,
  OracleSetup as OracleSetupRaw,
  RiskTier as RiskTierRaw,
} from "./generated/marginfi";

/**
 * Decodes a marginfi `Bank` account.
 * @throws if the discriminator doesn't match
 */
export function decodeBank(data: ReadonlyUint8Array): Bank {
  return decodeAccountData(data, BANK_DISCRIMINATOR, getBankDecoder(), "marginfi Bank");
}

/**
 * Decodes a marginfi `MarginfiAccount` account.
 * @throws if the discriminator doesn't match
 */
export function decodeMarginfiAccount(data: ReadonlyUint8Array): MarginfiAccount {
  return decodeAccountData(
    data,
    MARGINFI_ACCOUNT_DISCRIMINATOR,
    getMarginfiAccountDecoder(),
    "marginfi MarginfiAccount"
  );
}

/**
 * Decodes a marginfi `MarginfiGroup` account.
 * @throws if the discriminator doesn't match
 */
export function decodeMarginfiGroup(data: ReadonlyUint8Array): MarginfiGroup {
  return decodeAccountData(
    data,
    MARGINFI_GROUP_DISCRIMINATOR,
    getMarginfiGroupDecoder(),
    "marginfi MarginfiGroup"
  );
}

/**
 * Decodes the marginfi `FeeState` account (global fee wallet and fees).
 * @throws if the discriminator doesn't match
 */
export function decodeFeeState(data: ReadonlyUint8Array): FeeState {
  return decodeAccountData(
    data,
    FEE_STATE_DISCRIMINATOR,
    getFeeStateDecoder(),
    "marginfi FeeState"
  );
}
