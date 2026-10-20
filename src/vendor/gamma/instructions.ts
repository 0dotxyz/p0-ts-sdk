import { AccountRole, type Address, type Instruction } from "@solana/kit";

import {
  findDepositPolicyPda,
  getCompleteWithdrawalInstructionAsync,
  getDepositInstructionAsync,
  getWithdrawInstructionAsync,
  type CompleteWithdrawalAsyncInput,
  type DepositAsyncInput,
  type WithdrawAsyncInput,
} from "~/generated/gamma";

/**
 * Deposits `amount` (asset mint base units) into a Gamma LP vault; shares are minted in the same
 * transaction. The program creates the user's share ATA and deposit receipt if needed.
 */
export async function makeGammaDepositIx(input: DepositAsyncInput): Promise<Instruction> {
  return getDepositInstructionAsync(input);
}

/**
 * Initiates a withdrawal of `sharesAmount` (share mint base units) from a Gamma LP vault; shares are
 * escrowed until a keeper fulfills them. Appends the vault's DepositPolicy, which program >= 2.3.0
 * reads from remaining accounts to cap withdrawals at max(NAV, capacity).
 */
export async function makeGammaWithdrawIx(
  input: Omit<WithdrawAsyncInput, "lpVault"> & { lpVault: Address }
): Promise<Instruction> {
  const ix = await getWithdrawInstructionAsync(input);
  const [depositPolicy] = await findDepositPolicyPda({ lpVault: input.lpVault });
  return {
    ...ix,
    accounts: [...ix.accounts, { address: depositPolicy, role: AccountRole.READONLY }],
  };
}

/**
 * Claims the assets of a fulfilled Gamma withdrawal into the user's asset ATA (created if needed).
 * `escrowAssetsAccount` / `escrowSharesAccount` are the withdraw escrow's ATAs.
 */
export async function makeGammaCompleteWithdrawalIx(
  input: CompleteWithdrawalAsyncInput
): Promise<Instruction> {
  return getCompleteWithdrawalInstructionAsync(input);
}
