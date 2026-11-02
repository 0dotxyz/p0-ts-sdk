import {
  assertAccountExists,
  fetchEncodedAccount,
  type Address,
  type GetAccountInfoApi,
  type Rpc,
} from "@solana/kit";
import { TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";

import { TOKEN_2022_PROGRAM_ID } from "~/constants";
import {
  decodeGammaDepositPolicy,
  decodeGammaLpVault,
  decodeGammaWithdrawalPolicy,
  decodeGammaWithdrawReceipt,
  deriveGammaDepositPolicy,
  deriveGammaWithdrawalPolicy,
  deriveGammaWithdrawReceipt,
  type GammaDepositPolicy,
  type GammaLpVault,
  type GammaWithdrawalPolicy,
  type GammaWithdrawReceipt,
} from "~/vendor/gamma";

/**
 * Fetches a Gamma `LpVault`.
 * @throws if the account doesn't exist or isn't an `LpVault`
 */
export async function fetchGammaLpVault(
  rpc: Rpc<GetAccountInfoApi>,
  lpVault: Address
): Promise<GammaLpVault> {
  const account = await fetchEncodedAccount(rpc, lpVault);
  assertAccountExists(account);
  return decodeGammaLpVault(account.data);
}

/**
 * Fetches `user`'s withdraw receipt for `lpVault`: a queued withdrawal awaiting a keeper, or a
 * fulfilled one ready to claim. `null` when there's none (withdrawals only queue while the vault
 * is illiquid).
 * @throws if the receipt account isn't a `WithdrawReceipt`
 */
export async function fetchGammaWithdrawReceipt(
  rpc: Rpc<GetAccountInfoApi>,
  user: Address,
  lpVault: Address
): Promise<GammaWithdrawReceipt | null> {
  const [receipt] = await deriveGammaWithdrawReceipt(user, lpVault);
  const account = await fetchEncodedAccount(rpc, receipt);
  return account.exists ? decodeGammaWithdrawReceipt(account.data) : null;
}

/**
 * Fetches `lpVault`'s deposit policy: its deposit cap and pause switch. `null` when the vault has no
 * deposit policy account.
 * @throws if the account isn't a `DepositPolicy`
 */
export async function fetchGammaDepositPolicy(
  rpc: Rpc<GetAccountInfoApi>,
  lpVault: Address
): Promise<GammaDepositPolicy | null> {
  const [policy] = await deriveGammaDepositPolicy(lpVault);
  const account = await fetchEncodedAccount(rpc, policy);
  return account.exists ? decodeGammaDepositPolicy(account.data) : null;
}

/**
 * Fetches `lpVault`'s withdrawal policy: its withdrawal fee and rolling hourly/daily caps. `null`
 * when the vault has no withdrawal policy account.
 * @throws if the account isn't a `WithdrawalPolicy`
 */
export async function fetchGammaWithdrawalPolicy(
  rpc: Rpc<GetAccountInfoApi>,
  lpVault: Address
): Promise<GammaWithdrawalPolicy | null> {
  const [policy] = await deriveGammaWithdrawalPolicy(lpVault);
  const account = await fetchEncodedAccount(rpc, policy);
  return account.exists ? decodeGammaWithdrawalPolicy(account.data) : null;
}

/** Token program owning `assetsMint`: Token-2022 when it owns it, the Token program otherwise. */
export async function resolveVaultTokenProgram(
  rpc: Rpc<GetAccountInfoApi>,
  assetsMint: Address
): Promise<Address> {
  const account = await fetchEncodedAccount(rpc, assetsMint);
  return account.exists && account.programAddress === TOKEN_2022_PROGRAM_ID
    ? TOKEN_2022_PROGRAM_ID
    : TOKEN_PROGRAM_ADDRESS;
}
