import type { Address, ProgramDerivedAddress, ReadonlyUint8Array } from "@solana/kit";

import { decodeAccountData } from "../account-data";

import type {
  GammaDepositPolicy,
  GammaLpVault,
  GammaWithdrawalPolicy,
  GammaWithdrawReceipt,
} from "./types";

import {
  DEPOSIT_POLICY_DISCRIMINATOR,
  findCompleteWithdrawalWithdrawEscrowPda,
  findDepositPolicyPda,
  findWithdrawalPolicyPda,
  findWithdrawReceiptPda,
  getDepositPolicyDecoder,
  getLpVaultDecoder,
  getWithdrawalPolicyDecoder,
  getWithdrawReceiptDecoder,
  LP_VAULT_DISCRIMINATOR,
  WITHDRAWAL_POLICY_DISCRIMINATOR,
  WITHDRAW_RECEIPT_DISCRIMINATOR,
} from "~/generated/gamma";

export { GAMMA_VAULT_PROGRAM_ADDRESS } from "~/generated/gamma";

/**
 * Decodes a Gamma `LpVault` account.
 * @throws if the discriminator doesn't match
 */
export function decodeGammaLpVault(data: ReadonlyUint8Array): GammaLpVault {
  return decodeAccountData(data, LP_VAULT_DISCRIMINATOR, getLpVaultDecoder(), "Gamma LpVault");
}

/**
 * Decodes a Gamma `WithdrawReceipt` account (a user's pending → claimable withdrawal).
 * @throws if the discriminator doesn't match
 */
export function decodeGammaWithdrawReceipt(data: ReadonlyUint8Array): GammaWithdrawReceipt {
  return decodeAccountData(
    data,
    WITHDRAW_RECEIPT_DISCRIMINATOR,
    getWithdrawReceiptDecoder(),
    "Gamma WithdrawReceipt"
  );
}

/**
 * Decodes a Gamma `DepositPolicy` account (a vault's deposit cap + pause switch).
 * @throws if the discriminator doesn't match
 */
export function decodeGammaDepositPolicy(data: ReadonlyUint8Array): GammaDepositPolicy {
  return decodeAccountData(
    data,
    DEPOSIT_POLICY_DISCRIMINATOR,
    getDepositPolicyDecoder(),
    "Gamma DepositPolicy"
  );
}

/**
 * Decodes a Gamma `WithdrawalPolicy` account (a vault's withdrawal fee + rolling caps).
 * @throws if the discriminator doesn't match
 */
export function decodeGammaWithdrawalPolicy(data: ReadonlyUint8Array): GammaWithdrawalPolicy {
  return decodeAccountData(
    data,
    WITHDRAWAL_POLICY_DISCRIMINATOR,
    getWithdrawalPolicyDecoder(),
    "Gamma WithdrawalPolicy"
  );
}

/** `lpVault`'s deposit policy PDA. */
export function deriveGammaDepositPolicy(lpVault: Address): Promise<ProgramDerivedAddress> {
  return findDepositPolicyPda({ lpVault });
}

/** `lpVault`'s withdrawal policy PDA. */
export function deriveGammaWithdrawalPolicy(lpVault: Address): Promise<ProgramDerivedAddress> {
  return findWithdrawalPolicyPda({ lpVault });
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
