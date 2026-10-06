import type { ReadonlyUint8Array } from "@solana/kit";

import {
  BANK_DISCRIMINATOR,
  FEE_STATE_DISCRIMINATOR,
  getBankDecoder,
  getBankSize,
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
  MARGINFI_ACCOUNT_DISCRIMINATOR,
  BankOperationalState as OperationalStateRaw,
  OracleSetup as OracleSetupRaw,
  RiskTier as RiskTierRaw,
} from "./generated/marginfi";

/**
 * Decodes a marginfi `Bank` account. Banks not yet resized to the 0.1.12 layout
 * (`lending_pool_resize_bank_account`) lack the trailing padding; it's read as zeros, as the
 * program does after a resize.
 * @throws if the discriminator doesn't match
 */
export function decodeBankRaw(data: ReadonlyUint8Array): Bank {
  const padded = new Uint8Array(Math.max(data.length, getBankSize()));
  padded.set(data);
  return decodeAccountData(padded, BANK_DISCRIMINATOR, getBankDecoder(), "marginfi Bank");
}

/**
 * Decodes a marginfi `MarginfiAccount` account.
 * @throws if the discriminator doesn't match
 */
export function decodeMarginfiAccountRaw(data: ReadonlyUint8Array): MarginfiAccount {
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
export function decodeMarginfiGroupRaw(data: ReadonlyUint8Array): MarginfiGroup {
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
export function decodeFeeStateRaw(data: ReadonlyUint8Array): FeeState {
  return decodeAccountData(
    data,
    FEE_STATE_DISCRIMINATOR,
    getFeeStateDecoder(),
    "marginfi FeeState"
  );
}
