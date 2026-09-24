import type { Address, ProgramDerivedAddress, ReadonlyUint8Array } from "@solana/kit";

import { decodeAccountData } from "../account-data";

import {
  findCompleteWithdrawalWithdrawEscrowPda,
  findWithdrawReceiptPda,
  getLpVaultDecoder,
  getWithdrawReceiptDecoder,
  LP_VAULT_DISCRIMINATOR,
  WITHDRAW_RECEIPT_DISCRIMINATOR,
  type LpVault,
  type WithdrawReceipt,
} from "~/generated/gamma";

export { GAMMA_VAULT_PROGRAM_ADDRESS } from "~/generated/gamma";

/**
 * Decodes a Gamma `LpVault` account.
 * @throws if the discriminator doesn't match
 */
export function decodeGammaLpVault(data: ReadonlyUint8Array): LpVault {
  return decodeAccountData(data, LP_VAULT_DISCRIMINATOR, getLpVaultDecoder(), "Gamma LpVault");
}

/**
 * Decodes a Gamma `WithdrawReceipt` account (a user's pending → claimable withdrawal).
 * @throws if the discriminator doesn't match
 */
export function decodeGammaWithdrawReceipt(data: ReadonlyUint8Array): WithdrawReceipt {
  return decodeAccountData(
    data,
    WITHDRAW_RECEIPT_DISCRIMINATOR,
    getWithdrawReceiptDecoder(),
    "Gamma WithdrawReceipt"
  );
}

/** `user`'s withdraw receipt PDA for `lpVault`. */
export function deriveGammaWithdrawReceipt(
  user: Address,
  lpVault: Address
): Promise<ProgramDerivedAddress> {
  return findWithdrawReceiptPda({ crossChainWithdrawer: user, lpVault });
}

/** `user`'s withdraw escrow PDA for `lpVault` (owner of the escrow token accounts). */
export function deriveGammaWithdrawEscrow(
  user: Address,
  lpVault: Address
): Promise<ProgramDerivedAddress> {
  return findCompleteWithdrawalWithdrawEscrowPda({ user, lpVault });
}
